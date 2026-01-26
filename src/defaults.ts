import type {
  ReelDealIdleBob,
  ReelDealSpinBlur,
  ReelDealSpinConfig,
  ReelDealWebGLShading,
} from './types';

export const defaultSpinConfig: ReelDealSpinConfig = {
  minSpins: 2,
  durationMs: 4000,
  speedPxS: 4000,
  staggerMs: 300,
};

export const defaultWebGLShading: ReelDealWebGLShading = {
  warpAngleDeg: 90,
  edgePower: 0.5,
};

export const defaultSpinBlur: ReelDealSpinBlur = {
  maxPx: 4,
  speedAtMax: 2200,
};

export const defaultIdleBob: ReelDealIdleBob = {
  amplitudePx: 8,
  speedHz: 0.25,
  phaseOffsetRad: 0.9,
  delayMs: 500,
  rampMs: 800,
};
