import { defaultIdleBob, defaultSpinBlur, defaultSpinConfig } from './defaults';
import type { ReelDealIdleBob, ReelDealSpinBlur, ReelDealSpinConfig } from './types';
import { finiteOr, nonNegative, nonNegativeInt } from './utils/math';

const DEFAULT_MAX_DPR = 2;

type NormalizedSpinConfig = Required<ReelDealSpinConfig>;

export const normalizeSpinConfig = (
  overrides?: Partial<ReelDealSpinConfig>,
): NormalizedSpinConfig => {
  const base = { ...defaultSpinConfig, ...(overrides ?? {}) };

  return {
    minSpins: nonNegativeInt(base.minSpins, defaultSpinConfig.minSpins),
    durationMs: nonNegativeInt(base.durationMs, defaultSpinConfig.durationMs ?? 0),
    speedPxS: nonNegativeInt(base.speedPxS, defaultSpinConfig.speedPxS ?? 0),
    staggerMs: nonNegativeInt(base.staggerMs, defaultSpinConfig.staggerMs ?? 0),
  };
};

export const normalizeSpinBlur = (overrides?: Partial<ReelDealSpinBlur>): ReelDealSpinBlur => {
  const base = { ...defaultSpinBlur, ...(overrides ?? {}) };

  return {
    maxPx: nonNegative(base.maxPx, defaultSpinBlur.maxPx),
    speedAtMax: nonNegative(base.speedAtMax, defaultSpinBlur.speedAtMax),
  };
};

export const normalizeIdleBob = (
  overrides?: Partial<ReelDealIdleBob> | false,
): ReelDealIdleBob | null => {
  if (overrides === false) return null;

  const base = { ...defaultIdleBob, ...(overrides ?? {}) };

  return {
    amplitudePx: nonNegative(base.amplitudePx, defaultIdleBob.amplitudePx),
    speedHz: nonNegative(base.speedHz, defaultIdleBob.speedHz),
    phaseOffsetRad: finiteOr(base.phaseOffsetRad, defaultIdleBob.phaseOffsetRad),
    rampMs: nonNegativeInt(base.rampMs, defaultIdleBob.rampMs),
  };
};

export const normalizeMaxDpr = (value?: number): number =>
  Math.max(1, finiteOr(value, DEFAULT_MAX_DPR));
