export interface ReelDealSpinConfig {
  durationMs?: number;
  minSpins?: number;
  speedPxS?: number;
  staggerMs?: number;
}

export type ReelDealSpriteSource = string | HTMLImageElement;

export interface ReelDealSpinState {
  stopAtSegments: number[];
  callback?: (spinIndex: number, stopAtSegments: number[]) => void;
}

export interface ReelDealSpinRequest {
  stopAtSegments: number[];
  config?: Partial<ReelDealSpinConfig>;
  signal?: AbortSignal;
  timeoutMs?: number;
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
}

export interface ReelDealWebGLShading {
  warpAngleDeg: number;
  edgePower: number;
}

export interface ReelDealFinalSpinLine {
  thickness: number;
  intensity: number;
}

export interface ReelDealOptions {
  canvas?: HTMLCanvasElement | string;
  container?: HTMLElement | string;
  sprite?: ReelDealSpriteSource;
  slotCount?: number;
  initialSegments?: number[];
  button?: HTMLButtonElement | string;
  queuedSpinStates?: ReelDealSpinState[];
  reels?: number;
  spinConfig?: Partial<ReelDealSpinConfig>;
  spinBlur?: Partial<ReelDealSpinBlur>;
  webglShading?: Partial<ReelDealWebGLShading>;
  idleBob?: Partial<ReelDealIdleBob> | false;
  maxDpr?: number;
  finalSpinLine?: Partial<ReelDealFinalSpinLine> | false;
}
