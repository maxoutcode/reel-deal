import type { ReelDealIdleBob, ReelDealSpinBlur, ReelDealSpinConfig } from './types';

export const defaultSpinConfig: ReelDealSpinConfig = {
  minSpins: 2,
  durationMs: 4000,
  speedPxS: 4000,
  staggerMs: 300,
};

export const defaultSpinBlur: ReelDealSpinBlur = {
  maxPx: 4,
  speedAtMax: 2200,
};

export const defaultIdleBob: ReelDealIdleBob = {
  amplitudePx: 9,
  speedHz: 0.25,
  phaseOffsetRad: 0.9,
  rampMs: 800,
};

export const defaultWebglShading = {
  warpAngleDeg: 60,
  edgePower: 4.8,
} as const;

export const defaultFinalSpinLine = {
  thickness: 6,
  intensity: 1.0,
} as const;
