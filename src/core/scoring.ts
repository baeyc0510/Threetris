import {
  LAYER_SCORES,
  EXTRA_LAYER_SCORE,
  COMBO_POINTS,
  B2B_MULTIPLIER,
  SPIN_BONUS,
  LAYERS_PER_LEVEL,
  MAX_LEVEL,
} from "./constants";

export interface ClearResult {
  layers: number; // layers cleared this lock
  spin: boolean; // spin bonus earned
}

/** Tracks combo and back-to-back streaks and computes score deltas. */
export class ScoreState {
  score = 0;
  level = 1;
  clearedLayers = 0; // cumulative
  combo = -1; // -1 = no active combo chain
  backToBack = false;

  reset(): void {
    this.score = 0;
    this.level = 1;
    this.clearedLayers = 0;
    this.combo = -1;
    this.backToBack = false;
  }

  private baseLayerScore(layers: number): number {
    if (layers <= 0) return 0;
    if (layers < LAYER_SCORES.length) return LAYER_SCORES[layers];
    // 4+ layers: 1000 base plus extra per additional layer.
    return LAYER_SCORES[LAYER_SCORES.length - 1] + (layers - (LAYER_SCORES.length - 1)) * EXTRA_LAYER_SCORE;
  }

  /**
   * Apply a lock result. Returns the points gained (before drop points) and
   * whether a level-up occurred.
   */
  applyLock(result: ClearResult): { gained: number; leveledUp: boolean } {
    const prevLevel = this.level;
    let gained = 0;

    if (result.layers > 0) {
      let points = this.baseLayerScore(result.layers) * this.level;

      // A "difficult" clear is 4+ layers or a spin clear -> feeds back-to-back.
      const difficult = result.layers >= 4 || result.spin;
      if (result.spin) points += SPIN_BONUS * this.level;
      if (difficult && this.backToBack) points = Math.round(points * B2B_MULTIPLIER);
      this.backToBack = difficult;

      // Combo grows with each consecutive clearing lock.
      this.combo++;
      if (this.combo > 0) points += COMBO_POINTS * this.combo * this.level;

      gained += points;
      this.clearedLayers += result.layers;
      this.level = Math.min(MAX_LEVEL, 1 + Math.floor(this.clearedLayers / LAYERS_PER_LEVEL));
    } else {
      // A non-clearing lock breaks the combo; back-to-back survives.
      this.combo = -1;
      // A spin with no clear still awards a small bonus.
      if (result.spin) gained += Math.round(SPIN_BONUS * 0.25) * this.level;
    }

    this.score += gained;
    return { gained, leveledUp: this.level > prevLevel };
  }

  addDropPoints(points: number): void {
    this.score += points;
  }
}
