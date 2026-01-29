import type { ReelDealSpinState } from '../types';
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

  consume(): SpinQueueEntry | null {
    if (this.queue.length === 0) return null;

    const state = this.queue.shift();

    return {
      state: state ?? { stopAtSegments: [] },
      remaining: this.queue.length,
      isLast: this.queue.length === 0,
    };
  }
}
