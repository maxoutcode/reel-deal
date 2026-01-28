import type { ReelDealSpinState } from '../types';
import { clampInt } from '../utils/math';

export type SpinQueueConfig = {
  slotCount: number;
  reels: number;
  initialQueue?: ReelDealSpinState[] | null;
};

export type SpinQueueEntry = {
  state: ReelDealSpinState;
  remaining: number;
  isLast: boolean;
};

export class SpinQueueController {
  private readonly slotCount: number;
  private readonly reels: number;
  private queue: ReelDealSpinState[];

  constructor(config: SpinQueueConfig) {
    this.slotCount = Math.max(1, Math.floor(config.slotCount));
    this.reels = Math.max(1, Math.floor(config.reels));
    this.queue = [...(config.initialQueue ?? [])];
  }

  reset(queue: ReelDealSpinState[] | null | undefined): void {
    this.queue = [...(queue ?? [])];
  }

  hasPending(): boolean {
    return this.queue.length > 0;
  }

  consume(): SpinQueueEntry {
    if (this.queue.length === 0) {
      return {
        state: { stopAtSegments: this.buildRandomSegments() },
        remaining: 0,
        isLast: true,
      };
    }

    const state = this.queue.shift() ?? { stopAtSegments: this.buildRandomSegments() };

    return {
      state,
      remaining: this.queue.length,
      isLast: this.queue.length === 0,
    };
  }

  private buildRandomSegments(): number[] {
    const max = this.slotCount;
    const segments: number[] = [];

    for (let r = 0; r < this.reels; r += 1) {
      segments.push(clampInt(Math.floor(Math.random() * max), 0, max - 1));
    }

    return segments;
  }
}
