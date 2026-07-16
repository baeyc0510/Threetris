import type { Axis, Cell, PieceType } from "./types";
import { cloneOffsets } from "./pieces";
import { rotateOffsets, KICK_OFFSETS } from "./rotation";
import type { Board } from "./Board";

/**
 * The active falling piece: a rigid body of 4 cubes. It owns its pivot position
 * and its current integer offsets. Movement and rotation are only committed
 * after the Board validates the resulting cells.
 */
export class Piece {
  readonly type: PieceType;
  pos: Cell; // pivot position in board coordinates
  offsets: Cell[]; // current rotated offsets relative to pivot

  constructor(type: PieceType, pos: Cell) {
    this.type = type;
    this.pos = { ...pos };
    this.offsets = cloneOffsets(type);
  }

  /** Absolute board cells occupied by this piece. */
  cells(): Cell[] {
    return this.offsets.map((o) => ({
      x: this.pos.x + o.x,
      y: this.pos.y + o.y,
      z: this.pos.z + o.z,
    }));
  }

  /** Cells the piece would occupy at a translated position. */
  private cellsAt(pos: Cell, offsets: Cell[]): Cell[] {
    return offsets.map((o) => ({ x: pos.x + o.x, y: pos.y + o.y, z: pos.z + o.z }));
  }

  /** Attempt a translation; commits and returns true only if valid. */
  tryMove(board: Board, dx: number, dy: number, dz: number): boolean {
    const next: Cell = { x: this.pos.x + dx, y: this.pos.y + dy, z: this.pos.z + dz };
    if (board.isValid(this.cellsAt(next, this.offsets))) {
      this.pos = next;
      return true;
    }
    return false;
  }

  /**
   * Attempt a 90-degree rotation about an axis, trying wall-kick shifts if the
   * naive rotation collides. Commits and returns true on success.
   */
  tryRotate(board: Board, axis: Axis, dir: 1 | -1): boolean {
    const rotated = rotateOffsets(this.offsets, axis, dir);
    for (const kick of KICK_OFFSETS) {
      const pos: Cell = {
        x: this.pos.x + kick.x,
        y: this.pos.y + kick.y,
        z: this.pos.z + kick.z,
      };
      if (board.isValid(this.cellsAt(pos, rotated))) {
        this.pos = pos;
        this.offsets = rotated;
        return true;
      }
    }
    return false;
  }

  /** Drop distance until the piece would collide, without mutating it. */
  dropDistance(board: Board): number {
    let dist = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const test = this.cellsAt(
        { x: this.pos.x, y: this.pos.y, z: this.pos.z - (dist + 1) },
        this.offsets,
      );
      if (!board.isValid(test)) break;
      dist++;
    }
    return dist;
  }

  /** Ghost landing cells (hard-drop preview). */
  ghostCells(board: Board): Cell[] {
    const dist = this.dropDistance(board);
    return this.offsets.map((o) => ({
      x: this.pos.x + o.x,
      y: this.pos.y + o.y,
      z: this.pos.z + o.z - dist,
    }));
  }

  /** True if the piece is resting (cannot move further down). */
  isGrounded(board: Board): boolean {
    return this.dropDistance(board) === 0;
  }
}
