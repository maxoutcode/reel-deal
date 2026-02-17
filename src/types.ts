export interface ReelDealSpinConfig {
  minSpins: number;
  durationMs?: number;
  speedPxS?: number;
  extraSpinsPerReel?: number;
}

export type ReelDealSpriteSource = string | HTMLImageElement;

export interface ReelDealSpinState {
  stopAtSegments: number[];
  callback?: (spinIndex: number, stopAtSegments: number[]) => void;
}

export interface ReelDealSpinBlur {
  maxPx: number;
  speedAtMax: number;
}

export interface ReelDealIdleBob {
  amplitudePx: number;
  speedHz: number;
  phaseOffsetRad: number;
  rampMs: number;
  idleDelayMs: number;
}

export interface ReelDealWebGLShading {
  warpAngleDeg: number;
  edgePower: number;
  highlightEnabled?: boolean;
  highlightIntensity?: number;
  highlightRadiusPx?: number;
}

export interface ReelDealOptions {
  canvas: HTMLCanvasElement | string;
  container: HTMLElement | string;
  sprite: ReelDealSpriteSource;
  slotCount: number;
  initialSegments?: number[];
  button?: HTMLButtonElement | string;
  queuedSpinStates?: ReelDealSpinState[];
  reels?: number;
}
