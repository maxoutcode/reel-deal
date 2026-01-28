import { loadSprite } from './assets/spriteLoader';
import {
  buildSpinPlan,
  getStopSpringOffset,
  updateIdleOffsets,
  updateVelocities,
} from './core/animation';
import { RafLoop } from './core/loop';
import { SpinQueueController } from './core/spinQueue';
import { SpinUiController } from './core/uiControls';
import {
  normalizeFinalSpinLine,
  normalizeIdleBob,
  normalizeMaxDpr,
  normalizeSpinBlur,
  normalizeSpinConfig,
  normalizeWebGLShading,
} from './normalize';
import { WebGLRenderer } from './render/webglRenderer';
import type {
  ReelDealFinalSpinLine,
  ReelDealIdleBob,
  ReelDealOptions,
  ReelDealSpinBlur,
  ReelDealSpinConfig,
  ReelDealSpinRequest,
  ReelDealSpinState,
  ReelDealSpriteSource,
  ReelDealWebGLShading,
} from './types';
import { resolveElement } from './utils/dom';
import { clamp01, clampInt, reelProgress } from './utils/math';

const MAX_REELS = 5;
const SPIN_TICK_START = 0.72;
const SPIN_TICK_RANGE = 0.28;
const SPIN_TICK_MAX_PX = 7;
const STOP_SPRING_OVERSHOOT_PX = 55;
const STOP_SPRING_SETTLE_MS = 300;
const STOP_SPRING_MAX_RATIO = 0.35;

type SpinAnimation = {
  startTime: number;
  startOffsets: number[];
  deltas: number[];
  durationMs: number[];
  settleDurationMs: number[];
  targets: number[];
};

type RequiredOptions = ReelDealOptions & {
  canvas: HTMLCanvasElement | string;
  container: HTMLElement | string;
  sprite: ReelDealSpriteSource;
  slotCount: number;
};

export class ReelDeal {
  private readonly canvas: HTMLCanvasElement;
  private readonly container: HTMLElement;

  private readonly opts: RequiredOptions;
  private readonly visibleSlots = 3;
  private readonly heightScale = 2 / 3;
  private readonly centerIndex = 1;
  private readonly reels: number;
  private readonly spinConfig: ReturnType<typeof normalizeSpinConfig>;
  private readonly spinBlur: ReelDealSpinBlur;
  private readonly webglShading: ReelDealWebGLShading;
  private readonly idleBob: ReelDealIdleBob | null;
  private readonly maxDpr: number;
  private readonly finalSpinLine: ReelDealFinalSpinLine | null;

  private spriteImg: HTMLImageElement | null = null;
  private spriteWidth = 0;
  private spriteHeight = 0;
  private frameHeight = 0;

  private width = 0;
  private height = 0;
  private dpr = 1;

  private readonly offsets: Float32Array;
  private readonly velocities: Float32Array;
  private lastVelT: number | null = null;
  private readonly lastVelOffsets: Float32Array;
  private idleStartTime: number | null = null;
  private readonly idleBaseOffsets: Float32Array;

  private renderer: WebGLRenderer | null = null;
  private webglInitError: string | null = null;

  private anim: SpinAnimation | null = null;
  private readonly loop = new RafLoop();
  private pendingSpinResolvers: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
    cleanup: () => void;
  }> = [];

  private showFinalLine = false;
  private isLastSpin = false;

  private resizeObserver: ResizeObserver | null = null;
  private resizeQueued = false;

  private button: HTMLButtonElement | null = null;
  private uiController: SpinUiController | null = null;
  private readonly spinQueueController: SpinQueueController;

  constructor(options: ReelDealOptions) {
    if (!options.canvas) throw new Error('ReelDeal: canvas is required');
    if (!options.container) throw new Error('ReelDeal: container is required');
    if (!options.sprite) throw new Error('ReelDeal: sprite is required');
    if (options.slotCount === undefined) throw new Error('ReelDeal: slotCount is required');

    const required: RequiredOptions = {
      ...options,
      canvas: options.canvas,
      container: options.container,
      sprite: options.sprite,
      slotCount: clampInt(options.slotCount, 1, Number.MAX_SAFE_INTEGER),
    };

    this.opts = required;
    this.reels = clampInt(options.reels ?? 1, 1, MAX_REELS);
    this.spinConfig = normalizeSpinConfig(options.spinConfig);
    this.spinBlur = normalizeSpinBlur(options.spinBlur);
    this.webglShading = normalizeWebGLShading(options.webglShading);
    this.idleBob = normalizeIdleBob(options.idleBob);
    this.maxDpr = normalizeMaxDpr(options.maxDpr);
    this.finalSpinLine = normalizeFinalSpinLine(options.finalSpinLine);

    this.canvas = resolveElement<HTMLCanvasElement>(required.canvas, 'Canvas');
    this.container = resolveElement<HTMLElement>(required.container, 'Container');

    this.offsets = new Float32Array(this.reels);
    this.velocities = new Float32Array(this.reels);
    this.lastVelOffsets = new Float32Array(this.reels);
    this.idleBaseOffsets = new Float32Array(this.reels);

    this.spinQueueController = new SpinQueueController({
      slotCount: required.slotCount,
      reels: this.reels,
      initialQueue: required.queuedSpinStates,
    });
  }

  private initRenderer(): void {
    if (!this.spriteImg) return;

    const renderer = new WebGLRenderer();

    try {
      renderer.init({
        canvas: this.canvas,
        spriteImg: this.spriteImg,
        spriteWidth: this.spriteWidth,
        spriteHeight: this.spriteHeight,
        frameHeight: this.frameHeight,
        reels: this.reels,
        visibleSlots: this.visibleSlots,
        heightScale: this.heightScale,
        spinBlur: this.spinBlur,
        webglShading: this.webglShading,
        finalSpinLine: this.finalSpinLine,
      });
      this.webglInitError = renderer.getError();
      this.renderer = renderer;
    } catch (error) {
      this.webglInitError =
        renderer.getError() ?? (error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async init(): Promise<void> {
    const sprite = await loadSprite(this.opts.sprite, this.opts.slotCount);

    this.spriteImg = sprite.image;
    this.spriteWidth = sprite.spriteWidth;
    this.frameHeight = sprite.frameHeight;
    this.spriteHeight = sprite.spriteHeight;

    this.initRenderer();

    if (!this.renderer) {
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
    this.uiController = new SpinUiController(this.button, this.handleButtonClick);
    this.uiController.updateAvailability(true);

    this.render();
    this.startLoop();
  }

  destroy(): void {
    this.stop();

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.uiController?.dispose();
    this.uiController = null;

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
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

  spinOnce(
    request: ReelDealSpinRequest | number[],
    configOverride?: Partial<ReelDealSpinConfig>,
  ): Promise<void> {
    this.ensureReady();

    const normalizedRequest: ReelDealSpinRequest = Array.isArray(request)
      ? { stopAtSegments: request, config: configOverride }
      : request;

    if (normalizedRequest.signal?.aborted) {
      return Promise.reject(
        normalizedRequest.signal.reason ?? new DOMException('Aborted', 'AbortError'),
      );
    }

    const spinConfig = this.getSpinConfig(normalizedRequest.config ?? configOverride);
    const useSpeed = spinConfig.speedPxS > 0;
    const stopSpringOvershootPx = this.getStopSpringOvershootPx();
    const stopSpringSettleMs = Math.max(0, STOP_SPRING_SETTLE_MS);
    const plan = buildSpinPlan({
      stopAtSegments: normalizedRequest.stopAtSegments,
      currentOffsets: this.offsets,
      reels: this.reels,
      frameHeight: this.frameHeight,
      spriteHeight: this.spriteHeight,
      centerIndex: this.centerIndex,
      slotCount: this.opts.slotCount,
      spinConfig,
      stopSpringOvershootPx,
      stopSpringSettleMs,
      useSpeed,
    });

    if (plan.totalDelta === 0 || (plan.allSpinZero && plan.allSettleZero)) {
      for (let r = 0; r < this.reels; r += 1) {
        this.offsets[r] = plan.targets[r];
      }

      this.anim = null;

      this.resolvePendingSpins();
      this.render();

      return Promise.resolve();
    }

    const startTime = performance.now();

    this.anim = {
      startTime,
      startOffsets: plan.startOffsets,
      deltas: plan.deltas,
      durationMs: plan.durations,
      settleDurationMs: plan.settleDurationMs,
      targets: plan.targets,
    };
    this.idleStartTime = null;

    this.startLoop();

    const abortController = new AbortController();

    const abortListener = (): void => {
      const reason =
        abortController.signal.reason ?? normalizedRequest.signal?.reason ?? 'Spin aborted';

      this.stop(reason);
    };

    const externalAbort = (): void => {
      abortController.abort(
        normalizedRequest.signal?.reason ?? new DOMException('Aborted', 'AbortError'),
      );
    };

    if (normalizedRequest.signal) {
      normalizedRequest.signal.addEventListener('abort', externalAbort, { once: true });
    }

    let timeoutId: number | null = null;

    if (normalizedRequest.timeoutMs && normalizedRequest.timeoutMs > 0) {
      timeoutId = window.setTimeout(() => {
        abortController.abort(new DOMException('Spin timed out', 'TimeoutError'));
      }, normalizedRequest.timeoutMs);
    }

    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        if (timeoutId !== null) window.clearTimeout(timeoutId);

        abortController.signal.removeEventListener('abort', abortListener);

        if (normalizedRequest.signal) {
          normalizedRequest.signal.removeEventListener('abort', externalAbort);
        }
      };

      if (abortController.signal.aborted) {
        cleanup();

        reject(abortController.signal.reason ?? new DOMException('Aborted', 'AbortError'));

        return;
      }

      abortController.signal.addEventListener('abort', abortListener, { once: true });
      this.pendingSpinResolvers.push({
        resolve: () => {
          cleanup();
          resolve();
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
        cleanup,
      });
    });
  }

  private getSpinConfig(
    overrides?: Partial<ReelDealSpinConfig>,
  ): ReturnType<typeof normalizeSpinConfig> {
    if (!overrides) return this.spinConfig;

    return normalizeSpinConfig({ ...this.spinConfig, ...overrides });
  }

  private getStopSpringOvershootPx(): number {
    const cap = this.frameHeight * STOP_SPRING_MAX_RATIO;
    const overshoot = Math.max(0, STOP_SPRING_OVERSHOOT_PX);

    return Math.min(overshoot, cap);
  }

  async spinQueue(spins: ReelDealSpinState[]): Promise<void> {
    this.spinQueueController.reset(spins);
    this.uiController?.updateAvailability(true);

    for (let i = 0; i < spins.length; i += 1) {
      const spin = spins[i];

      await this.spinOnce(spin.stopAtSegments);

      spin.callback?.(i, spin.stopAtSegments);
    }

    this.uiController?.updateAvailability(true);
  }

  stop(error?: unknown): void {
    this.loop.stop();
    this.anim = null;

    if (error !== undefined) {
      this.rejectPendingSpins(error);
    } else {
      this.resolvePendingSpins();
    }

    this.lastVelT = null;

    this.velocities.fill(0);
  }

  private resolvePendingSpins(): void {
    if (this.pendingSpinResolvers.length === 0) return;

    const resolvers = this.pendingSpinResolvers;

    this.pendingSpinResolvers = [];

    for (const { resolve, cleanup } of resolvers) {
      cleanup();
      resolve();
    }
  }

  private rejectPendingSpins(error: unknown): void {
    if (this.pendingSpinResolvers.length === 0) return;

    const resolvers = this.pendingSpinResolvers;

    this.pendingSpinResolvers = [];

    for (const { reject, cleanup } of resolvers) {
      cleanup();
      reject(error);
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

  private handleButtonClick = async (): Promise<void> => {
    this.hideFinalLine();

    const entry = this.spinQueueController.consume();

    this.isLastSpin = entry.isLast;
    this.uiController?.updateAvailability(true);

    await this.spinOnce(entry.state.stopAtSegments);

    if (this.isLastSpin && this.finalSpinLine) {
      this.showFinalLineEffect();
    }
  };

  private resolveButton(): HTMLButtonElement | null {
    if (!this.opts.button) return null;

    return resolveElement<HTMLButtonElement>(this.opts.button, 'Button');
  }

  private shouldAnimate(): boolean {
    return this.anim !== null || this.idleBob !== null || this.showFinalLine;
  }

  private startLoop(): void {
    if (this.loop.isRunning()) return;
    if (!this.shouldAnimate()) return;

    this.loop.start(this.tick);
  }

  private tick = (now: number): boolean => {
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
          const t =
            duration <= 0 ? elapsed / settleDuration : (elapsed - duration) / settleDuration;
          const u = clamp01(t);
          const overshoot = startOffsets[r] + deltas[r] - targetOffset;
          const spring = getStopSpringOffset(overshoot, u);

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
          const targetOffset =
            this.anim.targets[r] ?? this.anim.startOffsets[r] + this.anim.deltas[r];

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

    return this.shouldAnimate();
  };

  private render(): void {
    if (!this.spriteImg) return;
    if (this.width <= 0 || this.height <= 0) return;
    if (!this.renderer) return;

    this.renderer.render({
      offsets: this.offsets,
      velocities: this.velocities,
      dpr: this.dpr,
    });
  }

  private updateVelocity(now: number): void {
    this.lastVelT = updateVelocities(
      now,
      {
        lastVelT: this.lastVelT,
        lastVelOffsets: this.lastVelOffsets,
        velocities: this.velocities,
      },
      this.offsets,
    );
  }

  private updateIdle(now: number): void {
    if (!this.idleBob) return;

    this.idleStartTime = updateIdleOffsets(
      now,
      {
        idleStartTime: this.idleStartTime,
        idleBaseOffsets: this.idleBaseOffsets,
        velocities: this.velocities,
      },
      this.idleBob,
      this.offsets,
      this.reels,
    );
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
    this.ensureCanvasCoversContainer();
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

    if (this.renderer) {
      this.renderer.onResize(this.canvas.width, this.canvas.height);
    }

    this.applyViewportCrop();
  }

  private getTargetDpr(): number {
    const rawDpr = window.devicePixelRatio || 1;
    const base = Math.max(1, rawDpr);

    return Math.min(this.maxDpr, base);
  }

  hideFinalLine(): void {
    this.showFinalLine = false;
    this.renderer?.hideFinalLine();

    this.render();
  }

  showFinalLineEffect(): void {
    if (!this.finalSpinLine) return;

    this.showFinalLine = true;
    this.renderer?.showFinalLine();

    this.startLoop();
  }
}
