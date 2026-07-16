// Shared types for the 3D Tetris logic layer.
// The logic layer is the source of truth; rendering only follows it.

/** The seven classic tetromino identities. */
export type PieceType = "I" | "O" | "T" | "S" | "Z" | "J" | "L";

/** An integer grid cell / offset in logic space (x = width, y = depth, z = height). */
export interface Cell {
  x: number;
  y: number;
  z: number;
}

/** Rotation axis in logic space. z is the vertical (fall) axis. */
export type Axis = "x" | "y" | "z";

/** Top-level game states (state machine). */
export type GameState = "menu" | "settings" | "playing" | "paused" | "gameover";

/** Camera framing modes. */
export type CameraMode = "corner" | "face";

/** Board footprint difficulty. Height is always 20 visible. */
export type BoardSize = 5 | 7 | 9 | 11;

export interface Settings {
  boardSize: BoardSize;
  cameraMode: CameraMode;
  sound: boolean;
}

/** Per-difficulty persisted records. */
export interface DifficultyRecord {
  bestScore: number;
  bestTimeMs: number;
}

export interface SaveData {
  records: Record<number, DifficultyRecord>;
  totalPlayMs: number;
}
