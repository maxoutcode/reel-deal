import type { ReelDealIdleBob, ReelDealSpinBlur, ReelDealWebGLShading } from './types';

export const defaultSpinBlur: ReelDealSpinBlur = {
  maxPx: 4,
  speedAtMax: 2200,
};

export const defaultIdleBob: ReelDealIdleBob = {
  amplitudePx: 9,
  speedHz: 0.25,
  phaseOffsetRad: 0.9,
  rampMs: 800,
  idleDelayMs: 50,
};

export const defaultWebGLShading: ReelDealWebGLShading = {
  warpAngleDeg: 60,
  edgePower: 4.8,
};
