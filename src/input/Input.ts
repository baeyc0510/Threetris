import type { GameManager } from "../core/GameManager";
import type { CameraRig } from "../render/CameraRig";
import { DAS_MS, ARR_MS } from "../core/constants";
import { snappedYaw } from "../core/orient";

/** Menu / overlay navigation, driven when the game is not in the playing state. */
export interface MenuHandlers {
  nav(dx: number, dy: number): void;
  select(): void;
  back(): void;
  restart(): void;
}

interface DirState {
  down: boolean;
  timer: number;
  repeating: boolean;
  dx: number; // arrow intent in a camera-neutral basis
  dy: number;
}

/**
 * Keyboard input. Arrow keys move the piece in a camera-relative frame with
 * DAS/ARR auto-repeat; W/A/S/D rotate; Q/E orbit the camera; menu keys are
 * forwarded to the UI when not playing.
 */
export class Input {
  private dirs: Record<string, DirState> = {
    ArrowUp: { down: false, timer: 0, repeating: false, dx: 0, dy: 1 },
    ArrowDown: { down: false, timer: 0, repeating: false, dx: 0, dy: -1 },
    ArrowRight: { down: false, timer: 0, repeating: false, dx: 1, dy: 0 },
    ArrowLeft: { down: false, timer: 0, repeating: false, dx: -1, dy: 0 },
  };
  private held = new Set<string>();

  constructor(
    private game: GameManager,
    private rig: CameraRig,
    private menu: MenuHandlers,
  ) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  private isPlaying(): boolean {
    return this.game.state === "playing";
  }

  /**
   * Camera-facing board axes, quantized to the nearest 90 degrees.
   *
   * The camera orbits in 90-degree snaps but *rests* on a diagonal in corner
   * mode (yaw = 45, 135, ...). At an exact diagonal the raw forward/right board
   * vectors are 45-45, so snapping "the dominant axis" is a coin-flip that used
   * to collapse all four arrows onto a single board axis (the other axis became
   * unreachable). Rounding the yaw to a multiple of 90 first (`snappedYaw`,
   * which also settles the corner-mode tie the same way every time) makes
   * `fwd`/`right` exact unit board axes, so the four arrows always map to four
   * distinct board directions regardless of the resting camera angle.
   */
  private boardAxes(): { fwd: { x: number; y: number }; right: { x: number; y: number } } {
    const yaw = snappedYaw(this.rig.getYaw());
    const fwd = { x: -Math.sin(yaw), y: -Math.cos(yaw) };
    const right = { x: -fwd.y, y: fwd.x };
    // Round away tiny float error so components are exactly -1/0/1.
    return {
      fwd: { x: Math.round(fwd.x), y: Math.round(fwd.y) },
      right: { x: Math.round(right.x), y: Math.round(right.y) },
    };
  }

  /**
   * Map an arrow intent (forward/right in screen space) to board (dx,dy) using
   * the quantized camera facing. Forward = into the screen; right = screen-right.
   */
  private mapToBoard(intentDx: number, intentDy: number): { dx: number; dy: number } {
    const { fwd, right } = this.boardAxes();
    // Axes are orthogonal unit board vectors, so the result is already exactly
    // one board step in a single direction.
    return {
      dx: fwd.x * intentDy + right.x * intentDx,
      dy: fwd.y * intentDy + right.y * intentDx,
    };
  }

  private moveDir(state: DirState): void {
    const { dx, dy } = this.mapToBoard(state.dx, state.dy);
    if (dx !== 0 || dy !== 0) this.game.move(dx, dy);
  }

  /**
   * Tumble the piece around the screen-horizontal axis (camera-right), choosing
   * the board rotation axis and direction from the current facing so the same
   * key always tips the piece the same way relative to what the player sees.
   * `forward` true tips the top away from the camera (into the screen).
   */
  private tumble(forward: boolean): void {
    const { fwd, right } = this.boardAxes();
    // Screen-right maps to whichever board axis it aligns with.
    const axis: "x" | "y" = Math.abs(right.x) >= Math.abs(right.y) ? "x" : "y";
    const rSign = axis === "x" ? Math.sign(right.x) : Math.sign(right.y);
    // A right-hand rotation about the +axis by dir=+1 moves the top (+z) toward
    // (rvec x z_up); `rSign` selects the rotation about the actual screen-right
    // vector, which moves the top toward that cross product.
    const rvec = axis === "x" ? { x: rSign, y: 0 } : { x: 0, y: rSign };
    const rXz = { x: rvec.y, y: -rvec.x };
    const towardFwd = rXz.x * fwd.x + rXz.y * fwd.y >= 0 ? 1 : -1;
    let dir = (rSign * towardFwd) as 1 | -1;
    if (!forward) dir = -dir as 1 | -1;
    this.game.rotate(axis, dir);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;

    // Prevent page scroll for game keys.
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Space",
        "ShiftLeft",
        "ShiftRight",
      ].includes(code)
    ) {
      e.preventDefault();
    }

    // --- Non-playing states: forward to menu navigation ---
    if (!this.isPlaying()) {
      if (e.repeat) return;
      switch (code) {
        case "ArrowUp":
          this.menu.nav(0, -1);
          break;
        case "ArrowDown":
          this.menu.nav(0, 1);
          break;
        case "ArrowLeft":
          this.menu.nav(-1, 0);
          break;
        case "ArrowRight":
          this.menu.nav(1, 0);
          break;
        case "Enter":
        case "NumpadEnter":
          this.menu.select();
          break;
        case "Escape":
          this.menu.back();
          break;
        case "KeyP":
          // Resume from pause.
          if (this.game.state === "paused") this.game.resume();
          break;
        case "KeyR":
          this.menu.restart();
          break;
      }
      return;
    }

    // --- Playing state ---
    switch (code) {
      case "ArrowUp":
      case "ArrowDown":
      case "ArrowLeft":
      case "ArrowRight": {
        const st = this.dirs[code];
        if (!st.down) {
          st.down = true;
          st.timer = 0;
          st.repeating = false;
          this.moveDir(st);
        }
        break;
      }
      case "KeyW":
        // Tumble the top away from the camera (into the screen).
        if (!e.repeat) this.tumble(true);
        break;
      case "KeyS":
        // Tumble the top toward the camera.
        if (!e.repeat) this.tumble(false);
        break;
      case "KeyA":
        // Spin left about the vertical axis (view-independent).
        if (!e.repeat) this.game.rotate("z", 1);
        break;
      case "KeyD":
        // Spin right about the vertical axis (view-independent).
        if (!e.repeat) this.game.rotate("z", -1);
        break;
      case "KeyQ":
        if (!this.held.has(code)) this.rig.rotate(1);
        break;
      case "KeyE":
        if (!this.held.has(code)) this.rig.rotate(-1);
        break;
      case "Space":
        if (!e.repeat) this.game.hardDrop();
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.game.setSoftDrop(true);
        break;
      case "KeyC":
        if (!e.repeat) this.game.hold();
        break;
      case "KeyP":
      case "Escape":
        if (!e.repeat) this.game.pause();
        break;
      case "KeyR":
        if (!e.repeat) this.game.newGame();
        break;
    }
    this.held.add(code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const code = e.code;
    this.held.delete(code);
    if (this.dirs[code]) {
      this.dirs[code].down = false;
    }
    if (code === "ShiftLeft" || code === "ShiftRight") {
      this.game.setSoftDrop(false);
    }
  };

  /** DAS/ARR auto-repeat tick. */
  update(dtMs: number): void {
    if (!this.isPlaying()) return;
    for (const code of Object.keys(this.dirs)) {
      const st = this.dirs[code];
      if (!st.down) continue;
      st.timer += dtMs;
      if (!st.repeating) {
        if (st.timer >= DAS_MS) {
          st.repeating = true;
          st.timer = 0;
          this.moveDir(st);
        }
      } else {
        while (st.timer >= ARR_MS) {
          st.timer -= ARR_MS;
          this.moveDir(st);
        }
      }
    }
  }
}
