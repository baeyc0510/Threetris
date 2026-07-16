import type { PieceType } from "./types";
import { PIECE_TYPES } from "./constants";

/**
 * 7-bag randomizer: each bag contains all seven tetrominoes once, shuffled.
 * Guarantees a fair, drought-free distribution.
 */
export class BagRandomizer {
  private queue: PieceType[] = [];

  constructor() {
    this.refill();
  }

  private refill(): void {
    const bag = [...PIECE_TYPES];
    // Fisher-Yates shuffle.
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    this.queue.push(...bag);
  }

  /** Take the next piece, refilling the bag as needed. */
  next(): PieceType {
    if (this.queue.length === 0) this.refill();
    return this.queue.shift()!;
  }

  /** Peek at the next `count` upcoming pieces without consuming them. */
  peek(count: number): PieceType[] {
    while (this.queue.length < count) this.refill();
    return this.queue.slice(0, count);
  }
}
