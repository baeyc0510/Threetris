import type { Axis, Cell } from "./types";

// Integer 90-degree rotations about each axis, applied to offsets around the
// origin. Because the entries are all 0/+1/-1 and the pivot is the origin,
// results always stay exactly on the integer lattice.
//
// dir = +1 is counter-clockwise looking down the positive axis; dir = -1 is the
// inverse. All rotations are exact inverses, so repeated single-direction
// rotation can reach every orientation.

export function rotateCell(cell: Cell, axis: Axis, dir: 1 | -1): Cell {
  const { x, y, z } = cell;
  switch (axis) {
    case "x":
      // rotate in the y-z plane
      return dir === 1
        ? { x, y: -z, z: y }
        : { x, y: z, z: -y };
    case "y":
      // rotate in the z-x plane
      return dir === 1
        ? { x: z, y, z: -x }
        : { x: -z, y, z: x };
    case "z":
      // rotate in the x-y plane
      return dir === 1
        ? { x: -y, y: x, z }
        : { x: y, y: -x, z };
  }
}

/** Rotate a whole set of offsets. */
export function rotateOffsets(offsets: Cell[], axis: Axis, dir: 1 | -1): Cell[] {
  return offsets.map((c) => rotateCell(c, axis, dir));
}

/**
 * Small wall-kick candidate translations, tried in order when a rotation lands
 * in an invalid spot. The identity (no shift) is first. This is a simplified 3D
 * kick table — enough to let rotations slip away from walls, floor and stacks.
 */
export const KICK_OFFSETS: Cell[] = [
  { x: 0, y: 0, z: 0 },
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 2, y: 0, z: 0 },
  { x: -2, y: 0, z: 0 },
  { x: 0, y: 2, z: 0 },
  { x: 0, y: -2, z: 0 },
];
