import { SPIN_TICK_RANGE, SPIN_TICK_START } from '../constants';
import type { ReelDealIdleBob, ReelDealSpinConfig } from '../types';
import { clamp01, clampInt, mod, rampHermite, reelProgress } from '../utils/math';

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

export type ActiveSpinPhase = 'spinning' | 'settling';

export type SpinStepResult = {
  allDone: boolean;
  phase: ActiveSpinPhase | null;
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

  const speedFromSymbols = Math.max(0, spinConfig.speedSymbolsS ?? 0);
  const speedFromSymbolsPxS = speedFromSymbols > 0 ? speedFromSymbols * frameHeight : 0;
  const speedFromUser = Math.max(0, Math.floor(spinConfig.speedPxS ?? 0));
  const durationMs = Math.max(0, Math.floor(spinConfig.durationMs ?? 0));
  const baseDistance = Math.max(1, distances[0] ?? 1);

  const speedPxS =
    speedFromSymbolsPxS > 0
      ? Math.max(1, Math.round(speedFromSymbolsPxS))
      : speedFromUser > 0
        ? speedFromUser
        : durationMs > 0
          ? Math.max(1, Math.round((baseDistance / durationMs) * 1000))
          : 1;
  const useFixedStopSchedule = speedFromSymbolsPxS <= 0 && speedFromUser <= 0 && durationMs > 0;
  const extraStopDelayMs = Math.round(((spriteHeight * extraSpinsPerReel) / speedPxS) * 1000);

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

    const dur = useFixedStopSchedule
      ? durationMs + r * extraStopDelayMs
      : Math.round((Math.abs(finalDelta) / speedPxS) * 1000);

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

export const applySpinPlanStep = (params: {
  elapsedMs: number;
  offsets: NumericArray;
  startOffsets: NumericArray;
  deltas: NumericArray;
  durationMs: NumericArray;
  settleDurationMs: NumericArray;
  targets: NumericArray;
  frameHeight: number;
  spritePxPerCssPx: number;
  stopSpringDamping: number;
  stopSpringOscillations: number;
  spinTickMaxPx: number;
}): SpinStepResult => {
  let allDone = true;
  let phase: ActiveSpinPhase | null = null;

  for (let r = 0; r < params.offsets.length; r += 1) {
    const duration = params.durationMs[r] ?? 0;
    const settleDuration = params.settleDurationMs[r] ?? 0;
    const startOffset = params.startOffsets[r] ?? 0;
    const delta = params.deltas[r] ?? 0;
    const targetOffset = params.targets[r] ?? startOffset + delta;

    if (duration > 0 && params.elapsedMs < duration) {
      const t = Math.min(1, params.elapsedMs / duration);
      const eased = reelProgress(t);
      const baseOffset = startOffset + delta * eased;

      let tick = 0;

      if (t > SPIN_TICK_START && params.frameHeight > 0) {
        const u = clamp01((t - SPIN_TICK_START) / SPIN_TICK_RANGE);
        const env = (1 - u) ** 2;
        const phaseRadians = (baseOffset / params.frameHeight) * Math.PI * 2;
        const tickMaxSpritePx = Math.max(0, params.spinTickMaxPx) * params.spritePxPerCssPx;
        const amp = Math.min(tickMaxSpritePx, params.frameHeight * 0.06);

        tick = Math.sin(phaseRadians) * env * amp;
      }

      params.offsets[r] = baseOffset + tick;
      allDone = false;
      phase = 'spinning';
      continue;
    }

    if (settleDuration > 0) {
      const t =
        duration <= 0
          ? params.elapsedMs / settleDuration
          : (params.elapsedMs - duration) / settleDuration;
      const u = clamp01(t);

      if (u < 1) {
        const overshoot = startOffset + delta - targetOffset;
        const spring = getStopSpringOffset(
          overshoot,
          u,
          params.stopSpringDamping,
          params.stopSpringOscillations,
        );

        params.offsets[r] = targetOffset + spring;
        allDone = false;
        if (phase !== 'spinning') phase = 'settling';
        continue;
      }
    }

    params.offsets[r] = targetOffset;
  }

  return { allDone, phase };
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

  const LEGACY_DECAY_PER_FRAME = 0.85;
  const LEGACY_REFERENCE_FPS = 60;
  const VELOCITY_TAU_S = -1 / (LEGACY_REFERENCE_FPS * Math.log(LEGACY_DECAY_PER_FRAME));
  const MAX_DT_S = 0.1;
  const dtClamped = Math.min(dt, MAX_DT_S);
  const velocityDecay = Math.exp(-dtClamped / VELOCITY_TAU_S);
  const velocityGain = 1 - velocityDecay;

  for (let r = 0; r < offsets.length; r += 1) {
    const v = (offsets[r] - state.lastVelOffsets[r]) / dtClamped;

    state.velocities[r] = state.velocities[r] * velocityDecay + v * velocityGain;
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
