import { defaultSpinConfig } from './defaults';
import { defaultIdleBob, defaultSpinBlur, defaultWebGLShading } from './internalDefaults';
import type {
  ReelDealIdleBob,
  ReelDealSpinBlur,
  ReelDealSpinConfig,
  ReelDealWebGLShading,
} from './types';
import { finiteOr } from './utils/math';

const DEFAULT_MAX_DPR = 2;

type NormalizedSpinConfig = Required<ReelDealSpinConfig>;

const nonNegativeOrDefault = (value: number | undefined, fallback: number): number => {
  const v = finiteOr(value, fallback);

  return v < 0 ? fallback : Math.max(0, v);
};

const nonNegativeIntOrDefault = (value: number | undefined, fallback: number): number => {
  const v = finiteOr(value, fallback);

  return v < 0 ? fallback : Math.max(0, Math.floor(v));
};

export const normalizeSpinConfig = (
  overrides?: Partial<ReelDealSpinConfig>,
): NormalizedSpinConfig => {
  const base = { ...defaultSpinConfig, ...(overrides ?? {}) };

  return {
    minSpins: nonNegativeIntOrDefault(base.minSpins, defaultSpinConfig.minSpins),
    durationMs: nonNegativeIntOrDefault(base.durationMs, defaultSpinConfig.durationMs ?? 0),
    speedPxS: nonNegativeIntOrDefault(base.speedPxS, defaultSpinConfig.speedPxS ?? 0),
    extraSpinsPerReel: nonNegativeIntOrDefault(
      base.extraSpinsPerReel,
      defaultSpinConfig.extraSpinsPerReel ?? 1,
    ),
  };
};

export const normalizeSpinBlur = (overrides?: Partial<ReelDealSpinBlur>): ReelDealSpinBlur => {
  const base = { ...defaultSpinBlur, ...(overrides ?? {}) };

  return {
    maxPx: nonNegativeOrDefault(base.maxPx, defaultSpinBlur.maxPx),
    speedAtMax: nonNegativeOrDefault(base.speedAtMax, defaultSpinBlur.speedAtMax),
  };
};

export const normalizeIdleBob = (
  overrides?: Partial<ReelDealIdleBob> | false,
): ReelDealIdleBob | null => {
  if (overrides === false) return null;

  const base = { ...defaultIdleBob, ...(overrides ?? {}) };

  return {
    amplitudePx: nonNegativeOrDefault(base.amplitudePx, defaultIdleBob.amplitudePx),
    speedHz: nonNegativeOrDefault(base.speedHz, defaultIdleBob.speedHz),
    phaseOffsetRad: finiteOr(base.phaseOffsetRad, defaultIdleBob.phaseOffsetRad),
    rampMs: nonNegativeIntOrDefault(base.rampMs, defaultIdleBob.rampMs),
    idleDelayMs: nonNegativeIntOrDefault(base.idleDelayMs, defaultIdleBob.idleDelayMs),
  };
};

export const normalizeWebGLShading = (
  overrides?: Partial<ReelDealWebGLShading>,
): ReelDealWebGLShading => {
  const base = { ...defaultWebGLShading, ...(overrides ?? {}) };

  return {
    warpAngleDeg: nonNegativeOrDefault(base.warpAngleDeg, defaultWebGLShading.warpAngleDeg),
    edgePower: nonNegativeOrDefault(base.edgePower, defaultWebGLShading.edgePower),
    highlightEnabled: base.highlightEnabled !== false,
    highlightIntensity: Math.max(
      0,
      Math.min(
        1,
        finiteOr(base.highlightIntensity, defaultWebGLShading.highlightIntensity ?? 0.92),
      ),
    ),
    highlightRadiusPx: Math.max(
      0,
      nonNegativeOrDefault(base.highlightRadiusPx, defaultWebGLShading.highlightRadiusPx ?? 14),
    ),
  };
};

export const normalizeMaxDpr = (value?: number): number =>
  Math.max(1, finiteOr(value, DEFAULT_MAX_DPR));
