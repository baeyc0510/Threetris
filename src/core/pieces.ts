import type { Cell, PieceType } from "./types";

// Canonical tetromino shapes, defined as integer offsets relative to a pivot
// cell at the origin (0,0,0). All shapes start flat in the horizontal XY plane
// (z = 0) so the player rotates them "up" to stack across Z layers.
//
// Rotation is done by multiplying each offset by an integer 90-degree rotation
// matrix about the origin, which always keeps coordinates on the integer
// lattice (see rotation.ts). Keeping the pivot at the origin is what makes this
// exact — no rounding drift.

export const PIECE_OFFSETS: Record<PieceType, Cell[]> = {
  // I: horizontal line of four.
  I: [
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
  ],
  // O: 2x2 square.
  O: [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 1, y: 1, z: 0 },
  ],
  // T
  T: [
    { x: 0, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
  ],
  // S
  S: [
    { x: 0, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 1, y: 1, z: 0 },
  ],
  // Z
  Z: [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: -1, y: 1, z: 0 },
  ],
  // J
  J: [
    { x: 0, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 1, z: 0 },
  ],
  // L
  L: [
    { x: 0, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 },
  ],
};

/** Deep copy a piece's canonical offsets. */
export function cloneOffsets(type: PieceType): Cell[] {
  return PIECE_OFFSETS[type].map((c) => ({ ...c }));
}
