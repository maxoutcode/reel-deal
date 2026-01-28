import {
  defaultFinalSpinLine,
  defaultIdleBob,
  defaultSpinBlur,
  defaultSpinConfig,
  defaultWebglShading,
} from './defaults';
import type {
  ReelDealFinalSpinLine,
  ReelDealIdleBob,
  ReelDealSpinBlur,
  ReelDealSpinConfig,
  ReelDealWebGLShading,
} from './types';
import { clamp01, finiteOr, nonNegative, nonNegativeInt } from './utils/math';

const DEFAULT_MAX_DPR = 2;

type NormalizedSpinConfig = Required<ReelDealSpinConfig>;

export const normalizeSpinConfig = (
  overrides?: Partial<ReelDealSpinConfig>,
): NormalizedSpinConfig => {
  const base = { ...defaultSpinConfig, ...(overrides ?? {}) };

  return {
    minSpins: nonNegativeInt(base.minSpins, defaultSpinConfig.minSpins ?? 0),
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

export const normalizeWebGLShading = (
  overrides?: Partial<ReelDealWebGLShading>,
): ReelDealWebGLShading => ({
  warpAngleDeg: nonNegative(overrides?.warpAngleDeg, defaultWebglShading.warpAngleDeg),
  edgePower: nonNegative(overrides?.edgePower, defaultWebglShading.edgePower),
});

export const normalizeFinalSpinLine = (
  overrides?: Partial<ReelDealFinalSpinLine> | false,
): ReelDealFinalSpinLine | null => {
  if (overrides === false) return null;
  if (!overrides) return null;

  return {
    thickness: nonNegative(overrides.thickness, defaultFinalSpinLine.thickness),
    intensity: clamp01(overrides.intensity ?? defaultFinalSpinLine.intensity),
  };
};
