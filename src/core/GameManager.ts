import type { Axis, BoardSize, Cell, GameState, PieceType } from "./types";
import { Board } from "./Board";
import { Piece } from "./Piece";
import { BagRandomizer } from "./rng";
import { ScoreState } from "./scoring";
import {
  BOARD_HEIGHT,
  VISIBLE_HEIGHT,
  LOCK_DELAY_MS,
  LOCK_RESET_LIMIT,
  SOFT_DROP_FACTOR,
  SOFT_DROP_POINTS,
  HARD_DROP_POINTS,
  gravityIntervalMs,
} from "./constants";

/** Push events for sound and visual effects (render pulls state each frame). */
export interface GameEvents {
  onSpawn?: (type: PieceType) => void;
  onMove?: () => void;
  onRotate?: () => void;
  onSoftDrop?: () => void;
  onHardDrop?: () => void;
  onLock?: () => void;
  onLayerClear?: (zsCleared: number[], layers: number, spin: boolean, type: PieceType) => void;
  onLevelUp?: (level: number) => void;
  onHold?: () => void;
  onGameOver?: () => void;
  onStateChange?: (state: GameState) => void;
}

const NEXT_QUEUE_SIZE = 5;

export class GameManager {
  board: Board;
  score = new ScoreState();
  boardSize: BoardSize;

  private bag = new BagRandomizer();
  active: Piece | null = null;
  holdType: PieceType | null = null;
  private holdUsed = false;

  private _state: GameState = "menu";
  private events: GameEvents;

  // timing
  private gravityAcc = 0;
  private softDropping = false;
  private lockTimer = 0;
  private lockArmed = false;
  private lockResets = 0;
  private lastActionRotate = false;

  elapsedMs = 0;

  constructor(boardSize: BoardSize, events: GameEvents = {}) {
    this.boardSize = boardSize;
    this.board = new Board(boardSize, BOARD_HEIGHT);
    this.events = events;
  }

  get state(): GameState {
    return this._state;
  }

  private setState(s: GameState): void {
    if (this._state === s) return;
    this._state = s;
    this.events.onStateChange?.(s);
  }

  // --- Lifecycle ---

  newGame(boardSize: BoardSize = this.boardSize): void {
    this.boardSize = boardSize;
    this.board = new Board(boardSize, BOARD_HEIGHT);
    this.bag = new BagRandomizer();
    this.score.reset();
    this.holdType = null;
    this.holdUsed = false;
    this.active = null;
    this.gravityAcc = 0;
    this.softDropping = false;
    this.resetLock();
    this.elapsedMs = 0;
    this.setState("playing");
    this.spawn();
  }

  pause(): void {
    if (this._state === "playing") this.setState("paused");
  }

  resume(): void {
    if (this._state === "paused") this.setState("playing");
  }

  togglePause(): void {
    if (this._state === "playing") this.pause();
    else if (this._state === "paused") this.resume();
  }

  toMenu(): void {
    this.setState("menu");
  }

  toSettings(): void {
    this.setState("settings");
  }

  // --- Spawning ---

  private spawnPos(): Cell {
    return {
      x: Math.floor((this.board.width - 1) / 2),
      y: Math.floor((this.board.depth - 1) / 2),
      z: VISIBLE_HEIGHT + 1, // inside the hidden spawn buffer
    };
  }

  private spawn(type?: PieceType): void {
    const t = type ?? this.bag.next();
    const piece = new Piece(t, this.spawnPos());
    this.gravityAcc = 0;
    this.softDropping = false;
    this.resetLock();
    this.lastActionRotate = false;

    if (!this.board.isValid(piece.cells())) {
      // Cannot place a new piece -> game over.
      this.active = piece;
      this.gameOver();
      return;
    }
    this.active = piece;
    this.holdUsed = false;
    this.events.onSpawn?.(t);
  }

  private gameOver(): void {
    this.setState("gameover");
    this.events.onGameOver?.();
  }

  // --- Lock delay helpers ---

  private resetLock(): void {
    this.lockTimer = 0;
    this.lockArmed = false;
    this.lockResets = 0;
  }

  private bumpLock(): void {
    // Called after a successful move/rotate while the piece is grounded.
    if (this.lockArmed && this.lockResets < LOCK_RESET_LIMIT) {
      this.lockTimer = 0;
      this.lockResets++;
    }
  }

  // --- Player actions (return true if the action succeeded) ---

  move(dx: number, dy: number): boolean {
    if (this._state !== "playing" || !this.active) return false;
    const ok = this.active.tryMove(this.board, dx, dy, 0);
    if (ok) {
      this.lastActionRotate = false;
      this.events.onMove?.();
      if (this.active.isGrounded(this.board)) this.bumpLock();
    }
    return ok;
  }

  rotate(axis: Axis, dir: 1 | -1): boolean {
    if (this._state !== "playing" || !this.active) return false;
    const ok = this.active.tryRotate(this.board, axis, dir);
    if (ok) {
      this.lastActionRotate = true;
      this.events.onRotate?.();
      if (this.active.isGrounded(this.board)) this.bumpLock();
    }
    return ok;
  }

  setSoftDrop(on: boolean): void {
    this.softDropping = on;
  }

  hardDrop(): void {
    if (this._state !== "playing" || !this.active) return;
    const dist = this.active.dropDistance(this.board);
    if (dist > 0) {
      this.active.tryMove(this.board, 0, 0, -dist);
      this.score.addDropPoints(dist * HARD_DROP_POINTS);
      this.lastActionRotate = false;
    }
    this.events.onHardDrop?.();
    this.lockPiece();
  }

  hold(): void {
    if (this._state !== "playing" || !this.active || this.holdUsed) return;
    const current = this.active.type;
    if (this.holdType === null) {
      this.holdType = current;
      this.spawn(); // next from bag
    } else {
      const swap = this.holdType;
      this.holdType = current;
      this.spawn(swap);
    }
    this.holdUsed = true;
    this.events.onHold?.();
  }

  // --- Per-frame update ---

  update(dtMs: number): void {
    if (this._state !== "playing" || !this.active) return;
    this.elapsedMs += dtMs;

    const interval = this.softDropping
      ? Math.max(15, gravityIntervalMs(this.score.level) / SOFT_DROP_FACTOR)
      : gravityIntervalMs(this.score.level);

    this.gravityAcc += dtMs;
    while (this.gravityAcc >= interval) {
      this.gravityAcc -= interval;
      this.step();
      if (this._state !== "playing" || !this.active) return;
    }

    // Lock delay countdown while grounded.
    if (this.active.isGrounded(this.board)) {
      if (!this.lockArmed) {
        this.lockArmed = true;
        this.lockTimer = 0;
      }
      this.lockTimer += dtMs;
      if (this.lockTimer >= LOCK_DELAY_MS) this.lockPiece();
    } else if (this.lockArmed) {
      // Left the ground again.
      this.lockArmed = false;
      this.lockTimer = 0;
    }
  }

  /** One gravity step downward. */
  private step(): void {
    if (!this.active) return;
    const moved = this.active.tryMove(this.board, 0, 0, -1);
    if (moved) {
      this.lastActionRotate = false;
      if (this.softDropping) {
        this.score.addDropPoints(SOFT_DROP_POINTS);
        this.events.onSoftDrop?.();
      }
    }
    // If it didn't move, the lock-delay logic in update() will handle locking.
  }

  // --- Locking & clearing ---

  private detectSpin(): boolean {
    if (!this.lastActionRotate || !this.active) return false;
    // Spin bonus: last successful action was a rotation and the piece can no
    // longer move in any of the four horizontal directions.
    const dirs: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    const cells = this.active.cells();
    for (const [dx, dy] of dirs) {
      const shifted = cells.map((c) => ({ x: c.x + dx, y: c.y + dy, z: c.z }));
      if (this.board.isValid(shifted)) return false;
    }
    return true;
  }

  private lockPiece(): void {
    if (!this.active) return;
    const piece = this.active;
    const spin = this.detectSpin();
    this.board.lock(piece.cells(), piece.type);
    this.events.onLock?.();

    const fullLayers = this.board.getFullLayers();
    if (fullLayers.length > 0) {
      this.board.clearLayers(fullLayers);
    }

    const prevLevel = this.score.level;
    this.score.applyLock({ layers: fullLayers.length, spin });
    if (fullLayers.length > 0 || spin) {
      this.events.onLayerClear?.(fullLayers, fullLayers.length, spin, piece.type);
    }
    if (this.score.level > prevLevel) this.events.onLevelUp?.(this.score.level);

    this.active = null;
    this.spawn();
  }

  // --- Queries for renderer / HUD ---

  nextQueue(count = NEXT_QUEUE_SIZE): PieceType[] {
    return this.bag.peek(count);
  }

  ghostCells(): Cell[] {
    return this.active ? this.active.ghostCells(this.board) : [];
  }

  activeCells(): Cell[] {
    return this.active ? this.active.cells() : [];
  }

  activeType(): PieceType | null {
    return this.active?.type ?? null;
  }

  /**
   * Highest settled layer, for camera framing. Deliberately excludes the falling
   * piece: a piece spawns near the top of the well, and following it would yank
   * the camera up on every spawn and clip the floor out of view. The view should
   * track the built stack instead, rising only as blocks actually lock in.
   */
  effectiveStackHeight(): number {
    return Math.max(0, Math.min(this.board.stackHeight(), VISIBLE_HEIGHT));
  }
}
