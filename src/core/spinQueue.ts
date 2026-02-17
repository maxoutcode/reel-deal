import type { ReelDealSpinState } from '../types';
import { clampInt } from '../utils/math';
export type SpinQueueConfig = {
  slotCount: number;
  reels: number;
  initialQueue?: ReelDealSpinState[] | null;
};

export class SpinQueueController {
  private readonly slotCount: number;
  private readonly reels: number;
  private queue: ReelDealSpinState[];

  constructor(config: SpinQueueConfig) {
    this.slotCount = Math.max(1, Math.floor(config.slotCount));
    this.reels = Math.max(1, Math.floor(config.reels));
    this.queue = (config.initialQueue ?? []).map((entry) => this.normalizeState(entry));
  }

  hasPending(): boolean {
    return this.queue.length > 0;
  }

  consume(): ReelDealSpinState | null {
    if (this.queue.length === 0) return null;

    return this.queue.shift() ?? null;
  }

  private normalizeState(state: ReelDealSpinState): ReelDealSpinState {
    const normalizedStops = new Array(this.reels);

    for (let r = 0; r < this.reels; r += 1) {
      normalizedStops[r] = clampInt(state.stopAtSegments[r] ?? 0, 0, this.slotCount - 1);
    }

    return {
      stopAtSegments: normalizedStops,
      callback: state.callback,
    };
  }
}
