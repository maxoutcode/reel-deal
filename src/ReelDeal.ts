import {
  type NormalizedSpinConfig,
  normalizeIdleBob,
  normalizeMaxDpr,
  normalizeSpinBlur,
  normalizeSpinConfig,
} from './normalize';
import type {
  ReelDealIdleBob,
  ReelDealOptions,
  ReelDealSpinBlur,
  ReelDealSpinConfig,
  ReelDealSpinState,
} from './types';
import { resolveElement } from './utils/dom';
import { clamp01, clampInt, mod, nonNegative, rampHermite, reelProgress } from './utils/math';

const MAX_REELS = 5;
const SPIN_TICK_START = 0.72;
const SPIN_TICK_RANGE = 0.28;
const SPIN_TICK_MAX_PX = 7;
const VELOCITY_DECAY = 0.85;
const VELOCITY_GAIN = 1 - VELOCITY_DECAY;
const STOP_SPRING_OVERSHOOT_PX = 30;
const STOP_SPRING_SETTLE_MS = 500;
const STOP_SPRING_OSCILLATIONS = 1.25;
const STOP_SPRING_DAMPING = 4;
const STOP_SPRING_MAX_RATIO = 0.25;

type WebGLShadingConfig = {
  warpAngleDeg: number;
  edgePower: number;
};

const DEFAULT_WEBGL_SHADING: WebGLShadingConfig = {
  warpAngleDeg: 360,
  edgePower: 0.5,
};

const normalizeWebGLShading = (
  overrides?: Partial<WebGLShadingConfig>,
): WebGLShadingConfig => ({
  warpAngleDeg: nonNegative(overrides?.warpAngleDeg, DEFAULT_WEBGL_SHADING.warpAngleDeg),
  edgePower: nonNegative(overrides?.edgePower, DEFAULT_WEBGL_SHADING.edgePower),
});

type SpinAnimation = {
  startTime: number;
  startOffsets: number[];
  deltas: number[];
  durationMs: number[];
  settleDurationMs: number[];
  targets: number[];
};

export class ReelDeal {
  private readonly canvas: HTMLCanvasElement;
  private readonly container: HTMLElement;

  private readonly opts: ReelDealOptions;
  private readonly visibleSlots = 3;
  private readonly heightScale = 2 / 3;
  private readonly centerIndex = 1;
  private readonly reels: number;
  private readonly spinConfig: NormalizedSpinConfig;
  private readonly spinBlur: ReelDealSpinBlur;
  private readonly webglShading: WebGLShadingConfig;
  private readonly idleBob: ReelDealIdleBob | null;
  private readonly maxDpr: number;

  private spriteImg: HTMLImageElement | null = null;
  private spriteWidth = 0;
  private spriteHeight = 0;
  private frameHeight = 0;

  private width = 0;
  private height = 0;
  private dpr = 1;

  private offsets: number[];
  private velocities: number[];
  private lastVelT: number | null = null;
  private lastVelOffsets: number[];
  private idleStartTime: number | null = null;
  private idleBaseOffsets: number[];

  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private glProgram: WebGLProgram | null = null;
  private glBuffer: WebGLBuffer | null = null;
  private glTexture: WebGLTexture | null = null;
  private glAttribs: { pos: number; uv: number } | null = null;
  private webglInitError: string | null = null;
  private glUniforms: {
    texture: WebGLUniformLocation | null;
    reelX: WebGLUniformLocation | null;
    reelW: WebGLUniformLocation | null;
    offsetPx: WebGLUniformLocation | null;
    frameHeight: WebGLUniformLocation | null;
    spriteHeight: WebGLUniformLocation | null;
    visibleSlots: WebGLUniformLocation | null;
    heightScale: WebGLUniformLocation | null;
    edgePower: WebGLUniformLocation | null;
    warpAngle: WebGLUniformLocation | null;
    blurPx: WebGLUniformLocation | null;
  } | null = null;

  private anim: SpinAnimation | null = null;
  private rafId: number | null = null;
  private pendingSpinResolvers: Array<() => void> = [];

  private resizeObserver: ResizeObserver | null = null;
  private resizeQueued = false;

  private button: HTMLButtonElement | null = null;
  private buttonHandlerAttached = false;
  private spinning = false;
  private queuedSpins: ReelDealSpinState[] | null = null;

  constructor(options: ReelDealOptions) {
    this.opts = options;
    this.reels = clampInt(options.reels ?? 1, 1, MAX_REELS);
    this.spinConfig = normalizeSpinConfig(options.spinConfig);
    this.spinBlur = normalizeSpinBlur(options.spinBlur);
    this.webglShading = normalizeWebGLShading(
      (options as { webglShading?: Partial<WebGLShadingConfig> }).webglShading,
    );
    this.idleBob = normalizeIdleBob(options.idleBob);
    this.maxDpr = normalizeMaxDpr(options.maxDpr);

    this.canvas = resolveElement<HTMLCanvasElement>(options.canvas, 'Canvas');
    this.container = resolveElement<HTMLElement>(options.container, 'Container');

    this.offsets = new Array(this.reels).fill(0);
    this.velocities = new Array(this.reels).fill(0);
    this.lastVelOffsets = new Array(this.reels).fill(0);
    this.idleBaseOffsets = new Array(this.reels).fill(0);
  }

  async init(): Promise<void> {
    await this.loadSprite();

    this.tryInitWebGL();

    if (!this.gl) {
      throw new Error(
        `WebGL is not supported or failed to initialize. ${this.webglInitError ?? ''}`.trim(),
      );
    }

    this.syncContainerLayoutVars();
    this.ensureCanvasCoversContainer();
    this.setupResizeWatcher();
    this.resizeToContainer();

    this.setSegments(this.opts.initialSegments);

    this.button = this.resolveButton();
    this.queuedSpins = this.resolveSpinQueue();
    this.attachButtonHandler();

    this.render();
    this.startLoop();
  }

  destroy(): void {
    this.stop();

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.button && this.buttonHandlerAttached) {
      this.button.removeEventListener('click', this.handleButtonClick);
      this.buttonHandlerAttached = false;
    }

    this.releaseWebGLResources();
  }

  private ensureCanvasCoversContainer(): void {
    if (this.canvas === this.container) return;
    if (!this.container.contains(this.canvas)) return;

    if (!this.canvas.style.width) this.canvas.style.width = '100%';
    if (!this.canvas.style.height) this.canvas.style.height = '100%';
    if (!this.canvas.style.display) this.canvas.style.display = 'block';
  }

  private syncContainerLayoutVars(): void {
    const target = this.canvas === this.container ? this.canvas : this.container;

    target.style.setProperty('--reels', String(this.reels));
    target.style.setProperty('--visible-slots', String(this.visibleSlots));
    target.style.aspectRatio = `${this.reels} / ${this.visibleSlots * this.heightScale}`;

    if (this.canvas !== this.container) {
      this.container.style.overflow = 'hidden';
    }
  }

  setSegments(initialSegments?: number[]): void {
    this.ensureReady();

    const segments = initialSegments ?? [];

    for (let r = 0; r < this.reels; r += 1) {
      const segIndex = segments[r] ?? 0;
      const idx = clampInt(segIndex, 0, this.opts.slotCount - 1);

      this.offsets[r] = idx * this.frameHeight - this.centerIndex * this.frameHeight;
      this.lastVelOffsets[r] = this.offsets[r];
      this.velocities[r] = 0;
      this.idleBaseOffsets[r] = this.offsets[r];
    }

    this.lastVelT = null;
    this.idleStartTime = null;
    this.anim = null;

    this.stop();
    this.render();
    this.startLoop();
  }

  setSegment(segmentIndex: number): void {
    this.setSegments(new Array(this.reels).fill(segmentIndex));
  }

  spinOnce(stopAtSegments: number[], config?: Partial<ReelDealSpinConfig>): Promise<void> {
    this.ensureReady();

    const { minSpins, staggerMs, speedPxS, durationMs } = this.getSpinConfig(config);
    const useSpeed = speedPxS > 0;
    const stopSpringOvershootPx = this.getStopSpringOvershootPx();
    const stopSpringSettleMs = Math.max(0, STOP_SPRING_SETTLE_MS);
    const stopSpringEnabled = stopSpringSettleMs > 0 && stopSpringOvershootPx > 0;

    const startOffsets = new Array(this.reels);
    const deltas = new Array(this.reels);
    const durations = new Array(this.reels);
    const settleDurationMs = new Array(this.reels);
    const targets = new Array(this.reels);

    for (let r = 0; r < this.reels; r += 1) {
      const idx = clampInt(stopAtSegments[r] ?? 0, 0, this.opts.slotCount - 1);
      const desiredTop = idx * this.frameHeight - this.centerIndex * this.frameHeight;
      const desired = mod(desiredTop, this.spriteHeight);
      const current = mod(this.offsets[r], this.spriteHeight);

      const alignDelta = mod(current - desired, this.spriteHeight);

      let delta = -(minSpins * this.spriteHeight + alignDelta);

      if (useSpeed && durationMs > 0) {
        const desiredDistance = (speedPxS * durationMs) / 1000;
        const loops = Math.max(
          minSpins,
          Math.ceil(Math.max(0, desiredDistance - alignDelta) / this.spriteHeight),
        );

        delta = -(alignDelta + loops * this.spriteHeight);
      }

      if (staggerMs > 0 && useSpeed) {
        const extraDelta = (speedPxS * staggerMs * r) / 1000;
        const extraLoops = Math.ceil(extraDelta / this.spriteHeight);

        delta -= extraLoops * this.spriteHeight;
      }

      startOffsets[r] = this.offsets[r];
      targets[r] = this.offsets[r] + delta;

      let finalDelta = delta;
      let settleDuration = 0;

      if (stopSpringEnabled && delta !== 0 && stopSpringOvershootPx > 0) {
        const direction = Math.sign(delta);
        const overshoot = direction * stopSpringOvershootPx;

        finalDelta += overshoot;
        settleDuration = stopSpringSettleMs;
      }

      deltas[r] = finalDelta;
      settleDurationMs[r] = settleDuration;

      if (useSpeed) {
        durations[r] = Math.max(0, Math.round((Math.abs(finalDelta) / speedPxS) * 1000));
      } else {
        durations[r] = Math.max(0, durationMs + staggerMs * r);
      }
    }

    const totalDelta = deltas.reduce((acc, v) => acc + Math.abs(v), 0);
    const allSpinZero = durations.every((entry) => entry <= 0);
    const allSettleZero = settleDurationMs.every((entry) => entry <= 0);

    if (totalDelta === 0 || (allSpinZero && allSettleZero)) {
      for (let r = 0; r < this.reels; r += 1) {
        this.offsets[r] = targets[r];
      }

      this.anim = null;
      this.resolvePendingSpins();
      this.render();

      return Promise.resolve();
    }

    const startTime = performance.now();

    this.anim = {
      startTime,
      startOffsets,
      deltas,
      durationMs: durations,
      settleDurationMs,
      targets,
    };
    this.idleStartTime = null;
    this.startLoop();

    return new Promise((resolve) => {
      this.pendingSpinResolvers.push(resolve);
    });
  }

  private getSpinConfig(overrides?: Partial<ReelDealSpinConfig>): NormalizedSpinConfig {
    if (!overrides) return this.spinConfig;

    return normalizeSpinConfig({ ...this.spinConfig, ...overrides });
  }

  private getStopSpringOvershootPx(): number {
    const cap = this.frameHeight * STOP_SPRING_MAX_RATIO;
    const overshoot = Math.max(0, STOP_SPRING_OVERSHOOT_PX);

    return Math.min(overshoot, cap);
  }

  private getStopSpringOffset(overshoot: number, t: number): number {
    if (overshoot === 0) return 0;

    const decay = Math.exp(-STOP_SPRING_DAMPING * t);
    const angle = Math.PI * 2 * STOP_SPRING_OSCILLATIONS * t;

    return overshoot * decay * Math.cos(angle);
  }

  async spinQueue(spins: ReelDealSpinState[]): Promise<void> {
    for (let i = 0; i < spins.length; i += 1) {
      const spin = spins[i];

      await this.spinOnce(spin.stopAtSegments);

      spin.callback?.(i, spin.stopAtSegments);
    }
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);

    this.rafId = null;
    this.anim = null;
    this.resolvePendingSpins();
    this.lastVelT = null;

    for (let r = 0; r < this.reels; r += 1) {
      this.velocities[r] = 0;
    }
  }

  private resolvePendingSpins(): void {
    if (this.pendingSpinResolvers.length === 0) return;

    const resolvers = this.pendingSpinResolvers;

    this.pendingSpinResolvers = [];

    for (const resolve of resolvers) {
      resolve();
    }
  }

  requestResize(): void {
    this.queueResize();
  }

  private ensureReady(): void {
    if (
      !this.spriteImg ||
      this.spriteWidth <= 0 ||
      this.spriteHeight <= 0 ||
      this.frameHeight <= 0
    ) {
      throw new Error('Sprite is not ready. Call init() and await it first.');
    }
  }

  private attachButtonHandler(): void {
    if (!this.button || this.buttonHandlerAttached) return;

    this.button.addEventListener('click', this.handleButtonClick, { passive: true });
    this.buttonHandlerAttached = true;
  }

  private handleButtonClick = async (): Promise<void> => {
    if (this.spinning) return;

    const spin = this.consumeNextSpin() ?? {
      stopAtSegments: this.buildRandomSegments(),
    };

    this.spinning = true;
    this.setButtonDisabled(true);

    try {
      await this.spinOnce(spin.stopAtSegments);
    } finally {
      if (this.queuedSpins && this.queuedSpins.length === 0) {
        this.setButtonDisabled(true);
      } else {
        this.setButtonDisabled(false);
      }

      this.spinning = false;
    }
  };

  private resolveButton(): HTMLButtonElement | null {
    if (!this.opts.button) return null;

    return resolveElement<HTMLButtonElement>(this.opts.button, 'Button');
  }

  private resolveSpinQueue(): ReelDealSpinState[] | null {
    return this.opts.queuedSpinStates ?? null;
  }

  private consumeNextSpin(): ReelDealSpinState | null {
    if (!this.queuedSpins) {
      this.queuedSpins = this.resolveSpinQueue();
    }

    if (!this.queuedSpins || this.queuedSpins.length === 0) return null;

    return this.queuedSpins.shift() ?? null;
  }

  private buildRandomSegments(): number[] {
    const max = Math.max(1, Math.floor(this.opts.slotCount));
    const segments: number[] = [];

    for (let r = 0; r < this.reels; r += 1) {
      segments.push(Math.floor(Math.random() * max));
    }

    return segments;
  }

  private setButtonDisabled(disabled: boolean): void {
    if (!this.button) return;

    this.button.disabled = disabled;

    if (disabled) this.button.setAttribute('aria-busy', 'true');
    else this.button.removeAttribute('aria-busy');
  }

  private shouldAnimate(): boolean {
    return this.anim !== null || this.idleBob !== null;
  }

  private startLoop(): void {
    if (this.rafId !== null) return;
    if (!this.shouldAnimate()) return;

    this.rafId = requestAnimationFrame(this.loop);
  }

  private loop = (now: number): void => {
    if (this.anim) {
      const { startTime, durationMs, startOffsets, deltas, settleDurationMs, targets } = this.anim;
      const elapsed = now - startTime;

      let allDone = true;

      for (let r = 0; r < this.reels; r += 1) {
        const duration = durationMs[r] ?? 0;
        const settleDuration = settleDurationMs[r] ?? 0;
        const targetOffset = targets[r] ?? startOffsets[r] + deltas[r];

        if (duration > 0 && elapsed < duration) {
          const t = Math.min(1, elapsed / duration);
          const eased = reelProgress(t);

          if (t < 1) allDone = false;

          const baseOffset = startOffsets[r] + deltas[r] * eased;

          let tick = 0;

          if (t > SPIN_TICK_START && this.frameHeight > 0) {
            const u = clamp01((t - SPIN_TICK_START) / SPIN_TICK_RANGE);
            const env = (1 - u) ** 2;
            const phase = (baseOffset / this.frameHeight) * Math.PI * 2;
            const amp = Math.min(SPIN_TICK_MAX_PX, this.frameHeight * 0.06);

            tick = Math.sin(phase) * env * amp;
          }

          this.offsets[r] = baseOffset + tick;
        } else if (settleDuration > 0) {
          const t = duration <= 0 ? elapsed / settleDuration : (elapsed - duration) / settleDuration;
          const u = clamp01(t);
          const overshoot = startOffsets[r] + deltas[r] - targetOffset;
          const spring = this.getStopSpringOffset(overshoot, u);

          if (u < 1) allDone = false;

          this.offsets[r] = targetOffset + spring;
        } else {
          this.offsets[r] = targetOffset;
        }
      }

      this.updateVelocity(now);
      this.render();

      if (allDone) {
        for (let r = 0; r < this.reels; r += 1) {
          const targetOffset = this.anim.targets[r] ?? this.anim.startOffsets[r] + this.anim.deltas[r];

          this.offsets[r] = targetOffset;
          this.idleBaseOffsets[r] = this.offsets[r];
        }

        this.updateVelocity(now);

        for (let r = 0; r < this.reels; r += 1) {
          this.velocities[r] = 0;
        }

        this.anim = null;
        this.idleStartTime = null;

        this.render();
        this.resolvePendingSpins();
      }
    } else if (this.idleBob) {
      this.updateIdle(now);
      this.render();
    }

    if (!this.shouldAnimate()) {
      this.rafId = null;

      return;
    }

    if (this.rafId === null) return;

    this.rafId = requestAnimationFrame(this.loop);
  };

  private render(): void {
    if (!this.spriteImg) return;
    if (this.width <= 0 || this.height <= 0) return;
    if (!this.gl) return;

    this.renderWebGL();
  }

  private getSpinBlurPxForReel(reel: number): number {
    if (!this.anim) return 0;

    const speed = Math.abs(this.velocities[reel] ?? 0);
    const speedAtMax = Math.max(1, this.spinBlur.speedAtMax);
    const t = clamp01(speed / speedAtMax);

    return t * Math.max(0, this.spinBlur.maxPx);
  }

  private renderWebGL(): void {
    if (
      !this.gl ||
      !this.glProgram ||
      !this.glAttribs ||
      !this.glUniforms ||
      !this.glTexture ||
      !this.glBuffer
    ) {
      return;
    }

    if (!this.spriteImg) return;

    const gl = this.gl;

    gl.useProgram(this.glProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glBuffer);

    gl.enableVertexAttribArray(this.glAttribs.pos);
    gl.vertexAttribPointer(this.glAttribs.pos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(this.glAttribs.uv);
    gl.vertexAttribPointer(this.glAttribs.uv, 2, gl.FLOAT, false, 16, 8);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.glTexture);
    gl.uniform1i(this.glUniforms.texture, 0);

    gl.uniform1f(this.glUniforms.frameHeight, this.frameHeight);
    gl.uniform1f(this.glUniforms.spriteHeight, this.spriteHeight);
    gl.uniform1f(this.glUniforms.visibleSlots, this.visibleSlots);
    gl.uniform1f(this.glUniforms.heightScale, this.heightScale);
    gl.uniform1f(this.glUniforms.edgePower, Math.max(0.5, this.webglShading.edgePower));

    const shading = this.webglShading;
    const warpAngle = (Math.max(0, shading.warpAngleDeg) * Math.PI) / 180;

    gl.uniform1f(this.glUniforms.warpAngle, warpAngle);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const reelW = 1 / this.reels;

    for (let r = 0; r < this.reels; r += 1) {
      gl.uniform1f(this.glUniforms.reelX, r * reelW);
      gl.uniform1f(this.glUniforms.reelW, reelW);

      const offsetPx = mod(this.offsets[r], this.spriteHeight);

      gl.uniform1f(this.glUniforms.offsetPx, offsetPx);
      gl.uniform1f(this.glUniforms.blurPx, this.getSpinBlurPxForReel(r));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  private updateVelocity(now: number): void {
    if (this.lastVelT === null) {
      this.lastVelT = now;

      for (let r = 0; r < this.reels; r += 1) {
        this.lastVelOffsets[r] = this.offsets[r];
        this.velocities[r] = 0;
      }

      return;
    }

    const dt = (now - this.lastVelT) / 1000;

    if (dt <= 0) return;

    for (let r = 0; r < this.reels; r += 1) {
      const v = (this.offsets[r] - this.lastVelOffsets[r]) / dt;

      this.velocities[r] = this.velocities[r] * VELOCITY_DECAY + v * VELOCITY_GAIN;
      this.lastVelOffsets[r] = this.offsets[r];
    }

    this.lastVelT = now;
  }

  private updateIdle(now: number): void {
    if (!this.idleBob) return;
    if (this.idleStartTime === null) this.idleStartTime = now;

    const { amplitudePx, speedHz, phaseOffsetRad, rampMs } = this.idleBob;
    const elapsedMs = now - this.idleStartTime;

    const tSec = elapsedMs / 1000;
    const rampT = Math.max(
      0,
      Math.min(1, elapsedMs / Math.max(1, rampMs)),
    );
    const ramp = rampHermite(rampT);
    const omega = speedHz * Math.PI * 2;

    for (let r = 0; r < this.reels; r += 1) {
      const phase = tSec * omega + r * phaseOffsetRad;

      this.offsets[r] = this.idleBaseOffsets[r] + Math.sin(phase) * (amplitudePx * ramp);
      this.velocities[r] = 0;
    }
  }

  private async loadSprite(): Promise<void> {
    const { sprite } = this.opts;
    const img = typeof sprite === 'string' ? new Image() : sprite;

    if (typeof sprite === 'string') {
      img.src = sprite;
    }

    if (!img.complete || img.naturalWidth <= 0) {
      await new Promise<void>((resolve, reject) => {
        const onLoad = () => resolve();
        const onError = () => reject(new Error('Failed to load sprite image'));

        img.addEventListener('load', onLoad, { once: true });
        img.addEventListener('error', onError, { once: true });
      });
    }

    const slotCount = Math.max(1, Math.floor(this.opts.slotCount));
    const spriteWidth = img.naturalWidth;
    const frameHeight = spriteWidth;
    const expectedSpriteHeight = frameHeight * slotCount;

    const naturalHeight = img.naturalHeight;
    const diff = Math.abs(naturalHeight - expectedSpriteHeight);

    if (diff > 2) {
      throw new Error(
        `Sprite size mismatch. Expected height ~${Math.round(expectedSpriteHeight)}px (slotCount=${slotCount}, slot aspect 1/1), got ${naturalHeight}px.`,
      );
    }

    this.spriteImg = img;
    this.spriteWidth = spriteWidth;
    this.frameHeight = Math.max(1, Math.round(frameHeight));
    this.spriteHeight = Math.max(1, Math.round(this.frameHeight * slotCount));
  }

  private setupResizeWatcher(): void {
    if (typeof ResizeObserver === 'undefined') return;
    if (this.resizeObserver) return;

    this.resizeObserver = new ResizeObserver(() => this.queueResize());
    this.resizeObserver.observe(this.container);
  }

  private queueResize = (): void => {
    if (this.resizeQueued) return;

    this.resizeQueued = true;

    requestAnimationFrame(() => {
      this.resizeQueued = false;
      this.resizeToContainer();
    });
  };

  private resizeToContainer(): void {
    const cssWidth = this.container.clientWidth;
    const cssHeight = this.container.clientHeight;
    const slotsViewport = this.visibleSlots * this.heightScale;

    if (cssWidth <= 0 || cssHeight <= 0) {
      this.applyResize(1, 1);

      return;
    }

    const slots = slotsViewport;
    const reels = this.reels;
    const fitByWidthH = (cssWidth / reels) * slots;

    let w = cssWidth;
    let h = fitByWidthH;

    if (h > cssHeight) {
      h = cssHeight;
      w = (cssHeight / slots) * reels;
    }

    const viewportWidth = Math.max(1, Math.floor(w));
    const viewportHeight = Math.max(1, Math.floor(h));

    this.applyResize(viewportWidth, viewportHeight);
    this.render();
  }

  private applyViewportCrop(): void {
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.transform = '';
  }

  private applyResize(width: number, height: number): void {
    const normalizedWidth = Math.max(1, Math.floor(width));
    const normalizedHeight = Math.max(1, Math.floor(height));

    const dpr = this.getTargetDpr();

    this.width = normalizedWidth;
    this.height = normalizedHeight;
    this.dpr = dpr;

    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);

    if (this.gl) {
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    this.applyViewportCrop();
  }

  private getTargetDpr(): number {
    const rawDpr = window.devicePixelRatio || 1;
    const base = Math.max(1, rawDpr);

    return Math.min(this.maxDpr, base);
  }

  private tryInitWebGL(): void {
    if (!this.spriteImg) return;

    this.releaseWebGLResources();
    this.webglInitError = null;

    const gl =
      (this.canvas.getContext('webgl2', {
        antialias: true,
        alpha: true,
      }) as WebGL2RenderingContext | null) ??
      (this.canvas.getContext('webgl', {
        antialias: true,
        alpha: true,
      }) as WebGLRenderingContext | null) ??
      (this.canvas.getContext('experimental-webgl', {
        antialias: true,
        alpha: true,
      }) as WebGLRenderingContext | null);

    if (!gl) {
      const fallback = document.createElement('canvas');
      const canWebGL = typeof WebGLRenderingContext !== 'undefined';
      const fallbackGl =
        (fallback.getContext('webgl2') as WebGL2RenderingContext | null) ??
        (fallback.getContext('webgl') as WebGLRenderingContext | null);

      this.webglInitError = `context is null (browser WebGL=${canWebGL ? 'yes' : 'no'}, fallback canvas=${fallbackGl ? 'yes' : 'no'})`;

      console.warn('ReelDeal WebGL:', this.webglInitError);

      return;
    }

    const vsSource = `
      attribute vec2 a_pos;
      attribute vec2 a_uv;
      varying vec2 v_uv;
      void main() {
        v_uv = a_uv;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;

    const fsSource = `
      #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
      #else
      precision mediump float;
      #endif

      varying vec2 v_uv;
      uniform sampler2D u_tex;
      uniform float u_reelX;
      uniform float u_reelW;
      uniform float u_offsetPx;
      uniform float u_frameHeight;
      uniform float u_spriteHeight;
      uniform float u_visibleSlots;
      uniform float u_heightScale;
      uniform float u_edgePower;
      uniform float u_warpAngle;
      uniform float u_blurPx;

      const float HALF_PI = 1.5707963;

      float saturate(float x) { return clamp(x, 0.0, 1.0); }

      void main() {
        if (v_uv.x < u_reelX || v_uv.x > (u_reelX + u_reelW)) {
          discard;
        }

        float localX = (v_uv.x - u_reelX) / u_reelW;
        float localY = v_uv.y;
        float hs = max(0.0001, u_heightScale);
        float fullY = localY * hs + (1.0 - hs) * 0.5;

        float warp = max(0.0, u_warpAngle);
        float warpStrength = saturate(warp / 1.2);
        float center = 0.5;
        float centerBand = 1.0 / 3.0;
        float halfBand = centerBand * 0.5;
        float dist = abs(fullY - center);
        float edgeWeight = smoothstep(halfBand, 0.5, dist);
        float edgePow = max(0.5, u_edgePower);
        edgeWeight = pow(edgeWeight, edgePow) * warpStrength;
        float yCentered = (fullY - 0.5) * 2.0;
        float sinY = 0.5 + 0.5 * sin(yCentered * HALF_PI);
        float warpedY = mix(fullY, sinY, edgeWeight);

        float yPx = u_offsetPx + warpedY * (u_frameHeight * u_visibleSlots);
        float v = fract((u_offsetPx / u_spriteHeight) +
                        warpedY * ((u_frameHeight * u_visibleSlots) / u_spriteHeight));

        vec4 base = texture2D(u_tex, vec2(localX, v));

        if (u_blurPx > 0.0) {
          float maxStepPx = 1.0 + 3.0 * saturate(u_blurPx / 4.0);
          float blurPx = min(u_blurPx, maxStepPx);
          float blurStep = blurPx / max(1.0, u_spriteHeight);
          vec4 sum = base * 0.227027;
          sum += texture2D(u_tex, vec2(localX, fract(v + blurStep))) * 0.1945946;
          sum += texture2D(u_tex, vec2(localX, fract(v - blurStep))) * 0.1945946;
          sum += texture2D(u_tex, vec2(localX, fract(v + 2.0 * blurStep))) * 0.1216216;
          sum += texture2D(u_tex, vec2(localX, fract(v - 2.0 * blurStep))) * 0.1216216;
          sum += texture2D(u_tex, vec2(localX, fract(v + 3.0 * blurStep))) * 0.054054;
          sum += texture2D(u_tex, vec2(localX, fract(v - 3.0 * blurStep))) * 0.054054;
          sum += texture2D(u_tex, vec2(localX, fract(v + 4.0 * blurStep))) * 0.016216;
          sum += texture2D(u_tex, vec2(localX, fract(v - 4.0 * blurStep))) * 0.016216;
          base = sum;
        }

        gl_FragColor = base;
      }
    `;

    const program = this.createWebGLProgram(gl, vsSource, fsSource);

    if (!program) {
      this.webglInitError = 'shader program failed to compile/link (see console)';

      console.warn('ReelDeal WebGL:', this.webglInitError);

      return;
    }

    const buffer = gl.createBuffer();

    if (!buffer) {
      this.webglInitError = 'failed to create vertex buffer';

      console.warn('ReelDeal WebGL:', this.webglInitError);

      gl.deleteProgram(program);

      return;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

    const quad = new Float32Array([-1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, 1, 1, 1, 0]);

    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    const texture = gl.createTexture();

    if (!texture) {
      this.webglInitError = 'failed to create texture';

      console.warn('ReelDeal WebGL:', this.webglInitError);

      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);

      return;
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.spriteImg);

    const isPowerOfTwo = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;
    const pot = isPowerOfTwo(this.spriteWidth) && isPowerOfTwo(this.spriteHeight);

    if (pot) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    gl.useProgram(program);
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.gl = gl;
    this.glProgram = program;
    this.glBuffer = buffer;
    this.glTexture = texture;
    this.glAttribs = {
      pos: gl.getAttribLocation(program, 'a_pos'),
      uv: gl.getAttribLocation(program, 'a_uv'),
    };
    this.glUniforms = {
      texture: gl.getUniformLocation(program, 'u_tex'),
      reelX: gl.getUniformLocation(program, 'u_reelX'),
      reelW: gl.getUniformLocation(program, 'u_reelW'),
      offsetPx: gl.getUniformLocation(program, 'u_offsetPx'),
      frameHeight: gl.getUniformLocation(program, 'u_frameHeight'),
      spriteHeight: gl.getUniformLocation(program, 'u_spriteHeight'),
      visibleSlots: gl.getUniformLocation(program, 'u_visibleSlots'),
      heightScale: gl.getUniformLocation(program, 'u_heightScale'),
      edgePower: gl.getUniformLocation(program, 'u_edgePower'),
      warpAngle: gl.getUniformLocation(program, 'u_warpAngle'),
      blurPx: gl.getUniformLocation(program, 'u_blurPx'),
    };
  }

  private createWebGLProgram(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    vsSource: string,
    fsSource: string,
  ): WebGLProgram | null {
    const vs = this.createWebGLShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = this.createWebGLShader(gl, gl.FRAGMENT_SHADER, fsSource);

    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);

      return null;
    }

    const program = gl.createProgram();

    if (!program) return null;

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) ?? 'unknown link error';

      this.webglInitError = `program link failed: ${info}`;

      console.warn('ReelDeal WebGL: program link failed', info);

      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);

      return null;
    }

    gl.detachShader(program, vs);
    gl.detachShader(program, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    return program;
  }

  private createWebGLShader(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    type: number,
    source: string,
  ): WebGLShader | null {
    const shader = gl.createShader(type);

    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) ?? 'unknown compile error';

      this.webglInitError = `shader compile failed: ${info}`;

      console.warn('ReelDeal WebGL: shader compile failed', info);

      gl.deleteShader(shader);

      return null;
    }

    return shader;
  }

  private releaseWebGLResources(): void {
    if (!this.gl) return;
    if (this.glTexture) this.gl.deleteTexture(this.glTexture);
    if (this.glBuffer) this.gl.deleteBuffer(this.glBuffer);
    if (this.glProgram) this.gl.deleteProgram(this.glProgram);

    this.glTexture = null;
    this.glBuffer = null;
    this.glProgram = null;
    this.glAttribs = null;
    this.glUniforms = null;
    this.gl = null;
  }
}
