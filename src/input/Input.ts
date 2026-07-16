import type { GameManager } from "../core/GameManager";
import type { CameraRig } from "../render/CameraRig";
import { DAS_MS, ARR_MS } from "../core/constants";

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
   * Map an arrow intent (forward/right in screen space) to board (dx,dy) using
   * the camera yaw. Forward = into the screen; right = screen-right.
   */
  private mapToBoard(intentDx: number, intentDy: number): { dx: number; dy: number } {
    const yaw = this.rig.getYaw();
    // Forward (into screen) in board space.
    const fwd = { x: -Math.sin(yaw), y: -Math.cos(yaw) };
    // Screen-right = camera right = cross(forward, up) projected to the board.
    const right = { x: -fwd.y, y: fwd.x };
    // Combine intent: dy = forward amount, dx = right amount.
    const vx = fwd.x * intentDy + right.x * intentDx;
    const vy = fwd.y * intentDy + right.y * intentDx;
    // Snap to the dominant board axis.
    if (Math.abs(vx) >= Math.abs(vy)) return { dx: Math.sign(vx) || 0, dy: 0 };
    return { dx: 0, dy: Math.sign(vy) || 0 };
  }

  private moveDir(state: DirState): void {
    const { dx, dy } = this.mapToBoard(state.dx, state.dy);
    if (dx !== 0 || dy !== 0) this.game.move(dx, dy);
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
        if (!e.repeat) this.game.rotate("x", 1);
        break;
      case "KeyA":
        if (!e.repeat) this.game.rotate("y", 1);
        break;
      case "KeyS":
        if (!e.repeat) this.game.rotate("z", 1);
        break;
      case "KeyD":
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
