import type { BoardSize, DifficultyRecord, SaveData, Settings } from "./types";
import { DEFAULT_BOARD_SIZE } from "./constants";

const SAVE_KEY = "threetris.save.v1";
const SETTINGS_KEY = "threetris.settings.v1";

const DEFAULT_SETTINGS: Settings = {
  boardSize: DEFAULT_BOARD_SIZE,
  cameraMode: "corner",
  sound: true,
};

function emptyRecord(): DifficultyRecord {
  return { bestScore: 0, bestTimeMs: 0 };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore quota / privacy errors */
  }
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { records: {}, totalPlayMs: 0 };
    const parsed = JSON.parse(raw) as SaveData;
    return { records: parsed.records ?? {}, totalPlayMs: parsed.totalPlayMs ?? 0 };
  } catch {
    return { records: {}, totalPlayMs: 0 };
  }
}

function persist(save: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    /* ignore */
  }
}

export function getRecord(size: BoardSize): DifficultyRecord {
  const save = loadSave();
  return save.records[size] ?? emptyRecord();
}

export function addTotalPlayTime(ms: number): void {
  const save = loadSave();
  save.totalPlayMs += ms;
  persist(save);
}

export function getTotalPlayTime(): number {
  return loadSave().totalPlayMs;
}

/**
 * Update the per-difficulty best score and best survival time. Returns which
 * records were newly beaten so the UI can celebrate them.
 */
export function submitResult(
  size: BoardSize,
  score: number,
  timeMs: number,
): { newBestScore: boolean; newBestTime: boolean } {
  const save = loadSave();
  const rec = save.records[size] ?? emptyRecord();
  const newBestScore = score > rec.bestScore;
  const newBestTime = timeMs > rec.bestTimeMs;
  if (newBestScore) rec.bestScore = score;
  if (newBestTime) rec.bestTimeMs = timeMs;
  save.records[size] = rec;
  persist(save);
  return { newBestScore, newBestTime };
}
