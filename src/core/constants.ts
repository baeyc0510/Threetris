import type { BoardSize, PieceType } from "./types";

// --- Board geometry ---
export const VISIBLE_HEIGHT = 20; // visible play area (z 0..19)
export const SPAWN_BUFFER = 4; // hidden buffer above the well
export const BOARD_HEIGHT = VISIBLE_HEIGHT + SPAWN_BUFFER; // internal 24

export const DEFAULT_BOARD_SIZE: BoardSize = 9;
export const BOARD_SIZES: BoardSize[] = [5, 7, 9, 11];

// --- Input feel ---
export const DAS_MS = 170; // delay before auto-repeat starts
export const ARR_MS = 45; // repeat interval once auto-repeat starts
export const LOCK_DELAY_MS = 500; // grace time after landing
export const LOCK_RESET_LIMIT = 15; // max move/rotate resets of lock delay
export const SOFT_DROP_FACTOR = 20; // soft drop is this many times faster than gravity

// --- Scoring ---
export const LAYER_SCORES = [0, 100, 300, 600, 1000]; // index = layers cleared
export const EXTRA_LAYER_SCORE = 400; // per layer beyond 4
export const SOFT_DROP_POINTS = 1; // per cell
export const HARD_DROP_POINTS = 2; // per cell
export const COMBO_POINTS = 50; // per combo step
export const B2B_MULTIPLIER = 1.5; // back-to-back difficult clears
export const SPIN_BONUS = 400;

// --- Level / gravity ---
export const LAYERS_PER_LEVEL = 5; // cleared layers needed per level up
export const MAX_LEVEL = 20;

/** Gravity interval in ms for a given level (classic-ish curve). */
export function gravityIntervalMs(level: number): number {
  const l = Math.min(Math.max(level, 1), MAX_LEVEL);
  // ~1000ms at level 1 down to ~60ms at max level.
  return Math.max(60, Math.round(1000 * Math.pow(0.8, l - 1)));
}

// --- Piece colors (synthwave neon) ---
export const PIECE_COLORS: Record<PieceType, number> = {
  I: 0x00f0ff, // cyan
  O: 0xffe000, // yellow
  T: 0xb84dff, // purple
  S: 0x2fff6a, // green
  Z: 0xff2d55, // red
  J: 0x3d7bff, // blue
  L: 0xff8a1e, // orange
};

export const PIECE_TYPES: PieceType[] = ["I", "O", "T", "S", "Z", "J", "L"];
