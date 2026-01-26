const SPIN_ACCEL_END = 0.1;
const SPIN_DECEL_START = 0.6;

export const clampInt = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.floor(value)));

export const mod = (n: number, m: number): number => ((n % m) + m) % m;

export const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

export const rampHermite = (u: number): number => {
  const x = clamp01(u);

  return x ** 2 * (2 - x);
};

export const brakeHermite = (u: number): number => {
  const x = clamp01(u);

  return x + x ** 2 - x ** 3;
};

export const reelProgress = (t: number): number => {
  const tt = clamp01(t);

  if (tt <= SPIN_ACCEL_END) {
    const u = tt / SPIN_ACCEL_END;

    return rampHermite(u) * SPIN_ACCEL_END;
  }

  if (tt < SPIN_DECEL_START) {
    return tt;
  }

  const u = (tt - SPIN_DECEL_START) / (1 - SPIN_DECEL_START);

  return SPIN_DECEL_START + brakeHermite(u) * (1 - SPIN_DECEL_START);
};

export const finiteOr = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const nonNegative = (value: number | undefined, fallback: number): number =>
  Math.max(0, finiteOr(value, fallback));

export const nonNegativeInt = (value: number | undefined, fallback: number): number =>
  Math.max(0, Math.floor(finiteOr(value, fallback)));
