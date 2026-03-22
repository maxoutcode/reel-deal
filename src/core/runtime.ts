import type { ReelDealPhase } from '../types';

export type ReelDealRuntimeState = {
  phase: ReelDealPhase;
  spinLastNow: number | null;
  spinAccumulatorMs: number;
  highlightStartedAt: number | null;
};

export const createRuntimeState = (): ReelDealRuntimeState => ({
  phase: 'idle',
  spinLastNow: null,
  spinAccumulatorMs: 0,
  highlightStartedAt: null,
});

export const startSpinRuntime = (state: ReelDealRuntimeState): void => {
  state.phase = 'spinning';
  state.spinLastNow = null;
  state.spinAccumulatorMs = 0;
  state.highlightStartedAt = null;
};

export const setSpinRuntimePhase = (
  state: ReelDealRuntimeState,
  phase: Extract<ReelDealPhase, 'spinning' | 'settling'>,
): void => {
  state.phase = phase;
};

export const resetSpinRuntime = (state: ReelDealRuntimeState): void => {
  state.spinLastNow = null;
  state.spinAccumulatorMs = 0;
};

export const enterIdleRuntime = (state: ReelDealRuntimeState): void => {
  resetSpinRuntime(state);
  state.phase = 'idle';
  state.highlightStartedAt = null;
};

export const enterHighlightRuntime = (state: ReelDealRuntimeState, now: number): void => {
  resetSpinRuntime(state);
  state.phase = 'highlight';
  if (state.highlightStartedAt === null) state.highlightStartedAt = now;
};
