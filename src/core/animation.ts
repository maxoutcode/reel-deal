import type { ReelDealIdleBob, ReelDealSpinConfig } from '../types';
import { clamp01, clampInt, mod, rampHermite } from '../utils/math';

type NumericArray = number[] | Float32Array | Int32Array | Uint32Array;

export type SpinPlan = {
  startOffsets: number[];
  deltas: number[];
  durations: number[];
  settleDurationMs: number[];
  targets: number[];
  totalDelta: number;
  allSpinZero: boolean;
  allSettleZero: boolean;
};

export type SpinPlanInput = {
  stopAtSegments: NumericArray;
  currentOffsets: NumericArray;
  reels: number;
  frameHeight: number;
  spriteHeight: number;
  centerIndex: number;
  slotCount: number;
  spinConfig: Required<ReelDealSpinConfig>;
  stopSpringOvershootPx: number;
  stopSpringSettleMs: number;
};

export const buildSpinPlan = (input: SpinPlanInput): SpinPlan => {
  const {
    stopAtSegments,
    currentOffsets,
    reels,
    frameHeight,
    spriteHeight,
    centerIndex,
    slotCount,
    spinConfig,
    stopSpringOvershootPx,
    stopSpringSettleMs,
  } = input;

  const startOffsets = new Array(reels);
  const deltas = new Array(reels);
  const durations = new Array(reels);
  const settleDurationMs = new Array(reels);
  const targets = new Array(reels);

  const minSpins = Math.max(0, Math.floor(spinConfig.minSpins));
  const extraSpinsPerReel = Math.max(0, Math.floor(spinConfig.extraSpinsPerReel ?? 1));

  const stopSpringEnabled = stopSpringSettleMs > 0 && stopSpringOvershootPx > 0;

  const distances = new Array<number>(reels);

  for (let r = 0; r < reels; r += 1) {
    const idx = clampInt(stopAtSegments[r] ?? 0, 0, slotCount - 1);
    const desiredTop = idx * frameHeight - centerIndex * frameHeight;
    const desired = mod(desiredTop, spriteHeight);
    const current = mod(currentOffsets[r], spriteHeight);
    const alignDelta = mod(current - desired, spriteHeight);
    const loops = minSpins + r * extraSpinsPerReel;

    distances[r] = alignDelta + loops * spriteHeight;
  }

  const speedFromUser = Math.max(0, Math.floor(spinConfig.speedPxS ?? 0));
  const durationMs = Math.max(0, Math.floor(spinConfig.durationMs ?? 0));
  const baseDistance = Math.max(1, distances[0] ?? 1);

  const speedPxS =
    speedFromUser > 0
      ? speedFromUser
      : durationMs > 0
        ? Math.max(1, Math.round((baseDistance / durationMs) * 1000))
        : 1;

  for (let r = 0; r < reels; r += 1) {
    const distance = distances[r] ?? 0;
    const delta = -distance;

    startOffsets[r] = currentOffsets[r];
    targets[r] = currentOffsets[r] + delta;

    let finalDelta = delta;
    let settleDuration = 0;

    if (stopSpringEnabled && delta !== 0) {
      finalDelta += Math.sign(delta) * stopSpringOvershootPx;
      settleDuration = stopSpringSettleMs;
    }

    deltas[r] = finalDelta;
    settleDurationMs[r] = settleDuration;

    const dur = Math.round((Math.abs(finalDelta) / speedPxS) * 1000);

    durations[r] = Math.max(0, dur);
  }

  const totalDelta = deltas.reduce((acc, v) => acc + Math.abs(v), 0);
  const allSpinZero = durations.every((entry) => entry <= 0);
  const allSettleZero = settleDurationMs.every((entry) => entry <= 0);

  return {
    startOffsets,
    deltas,
    durations,
    settleDurationMs,
    targets,
    totalDelta,
    allSpinZero,
    allSettleZero,
  };
};

export const getStopSpringOffset = (
  overshoot: number,
  t: number,
  damping = 5,
  oscillations = 1.25,
): number => {
  if (overshoot === 0) return 0;

  const decay = Math.exp(-damping * t);
  const angle = Math.PI * 2 * oscillations * t;

  return overshoot * decay * Math.cos(angle);
};

export type VelocityState = {
  lastVelT: number | null;
  lastVelOffsets: NumericArray;
  velocities: NumericArray;
};

export const updateVelocities = (
  now: number,
  state: VelocityState,
  offsets: NumericArray,
): number | null => {
  if (state.lastVelT === null) {
    state.lastVelT = now;

    for (let r = 0; r < offsets.length; r += 1) {
      state.lastVelOffsets[r] = offsets[r];
      state.velocities[r] = 0;
    }

    return state.lastVelT;
  }

  const dt = (now - state.lastVelT) / 1000;

  if (dt <= 0) return state.lastVelT;

  const VELOCITY_DECAY = 0.85;
  const VELOCITY_GAIN = 1 - VELOCITY_DECAY;

  for (let r = 0; r < offsets.length; r += 1) {
    const v = (offsets[r] - state.lastVelOffsets[r]) / dt;

    state.velocities[r] = state.velocities[r] * VELOCITY_DECAY + v * VELOCITY_GAIN;
    state.lastVelOffsets[r] = offsets[r];
  }

  state.lastVelT = now;

  return state.lastVelT;
};

export type IdleState = {
  idleStartTime: number | null;
  idleBaseOffsets: NumericArray;
  velocities: NumericArray;
};

export const updateIdleOffsets = (
  now: number,
  idleState: IdleState,
  idleBob: ReelDealIdleBob,
  offsets: NumericArray,
  reels: number,
): number | null => {
  if (idleState.idleStartTime === null) idleState.idleStartTime = now;

  const { amplitudePx, speedHz, phaseOffsetRad, rampMs, idleDelayMs } = idleBob;
  const elapsedMs = now - idleState.idleStartTime;

  if (elapsedMs < idleDelayMs) {
    for (let r = 0; r < reels; r += 1) {
      offsets[r] = idleState.idleBaseOffsets[r];
      idleState.velocities[r] = 0;
    }

    return idleState.idleStartTime;
  }

  const idleElapsedMs = elapsedMs - idleDelayMs;
  const tSec = idleElapsedMs / 1000;
  const rampT = clamp01(idleElapsedMs / Math.max(1, rampMs));
  const ramp = rampHermite(rampT);
  const omega = speedHz * Math.PI * 2;

  for (let r = 0; r < reels; r += 1) {
    const phase = tSec * omega + r * phaseOffsetRad;

    offsets[r] = idleState.idleBaseOffsets[r] + Math.sin(phase) * (amplitudePx * ramp);
    idleState.velocities[r] = 0;
  }

  return idleState.idleStartTime;
};
