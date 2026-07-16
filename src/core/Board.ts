import type { Cell, PieceType } from "./types";
import { BOARD_HEIGHT } from "./constants";

/** A single locked cell stores the piece type it came from (for color/type). */
export type BoardCell = PieceType | null;

/**
 * The discrete 3D well. Indexed as grid[z][y][x]:
 *   z = height / fall axis (0 = floor, up to BOARD_HEIGHT-1 including buffer)
 *   y = depth
 *   x = width
 * All collision, layer-fill and clearing decisions are made here on integers.
 */
export class Board {
  readonly width: number; // x
  readonly depth: number; // y
  readonly height: number; // z (internal, includes spawn buffer)
  private grid: BoardCell[][][];

  constructor(size: number, height: number = BOARD_HEIGHT) {
    this.width = size;
    this.depth = size;
    this.height = height;
    this.grid = Board.emptyGrid(size, size, height);
  }

  private static emptyLayer(w: number, d: number): BoardCell[][] {
    const layer: BoardCell[][] = [];
    for (let y = 0; y < d; y++) layer.push(new Array<BoardCell>(w).fill(null));
    return layer;
  }

  private static emptyGrid(w: number, d: number, h: number): BoardCell[][][] {
    const g: BoardCell[][][] = [];
    for (let z = 0; z < h; z++) g.push(Board.emptyLayer(w, d));
    return g;
  }

  reset(): void {
    this.grid = Board.emptyGrid(this.width, this.depth, this.height);
  }

  /** True if the coordinate is inside the board volume. */
  inBounds(c: Cell): boolean {
    return (
      c.x >= 0 &&
      c.x < this.width &&
      c.y >= 0 &&
      c.y < this.depth &&
      c.z >= 0 &&
      c.z < this.height
    );
  }

  /** True if the coordinate is inside bounds and currently empty. */
  isFree(c: Cell): boolean {
    return this.inBounds(c) && this.grid[c.z][c.y][c.x] === null;
  }

  /** True if every cell of a piece is free (no wall/floor/block collision). */
  isValid(cells: Cell[]): boolean {
    for (const c of cells) if (!this.isFree(c)) return false;
    return true;
  }

  get(c: Cell): BoardCell {
    return this.inBounds(c) ? this.grid[c.z][c.y][c.x] : null;
  }

  /** Permanently write a piece into the grid. */
  lock(cells: Cell[], type: PieceType): void {
    for (const c of cells) {
      if (this.inBounds(c)) this.grid[c.z][c.y][c.x] = type;
    }
  }

  /** Z-layers that are completely filled across the whole x/y footprint. */
  getFullLayers(): number[] {
    const full: number[] = [];
    for (let z = 0; z < this.height; z++) {
      let complete = true;
      for (let y = 0; y < this.depth && complete; y++) {
        for (let x = 0; x < this.width; x++) {
          if (this.grid[z][y][x] === null) {
            complete = false;
            break;
          }
        }
      }
      if (complete) full.push(z);
    }
    return full;
  }

  /**
   * Remove the given z-layers, dropping everything above them down by the
   * number of cleared layers below it. Colors/types are preserved.
   */
  clearLayers(zs: number[]): void {
    const clearSet = new Set(zs);
    const kept: BoardCell[][][] = [];
    for (let z = 0; z < this.height; z++) {
      if (!clearSet.has(z)) kept.push(this.grid[z]);
    }
    while (kept.length < this.height) {
      kept.push(Board.emptyLayer(this.width, this.depth));
    }
    this.grid = kept;
  }

  /** Read-only snapshot for the renderer: iterate all filled cells. */
  forEachFilled(cb: (x: number, y: number, z: number, type: PieceType) => void): void {
    for (let z = 0; z < this.height; z++) {
      for (let y = 0; y < this.depth; y++) {
        for (let x = 0; x < this.width; x++) {
          const t = this.grid[z][y][x];
          if (t !== null) cb(x, y, z, t);
        }
      }
    }
  }

  /** Highest occupied z-layer (or -1 if empty). Used for camera height. */
  stackHeight(): number {
    for (let z = this.height - 1; z >= 0; z--) {
      for (let y = 0; y < this.depth; y++) {
        for (let x = 0; x < this.width; x++) {
          if (this.grid[z][y][x] !== null) return z;
        }
      }
    }
    return -1;
  }
}
