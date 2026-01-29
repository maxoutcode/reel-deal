import { loadSprite } from './assets/spriteLoader';
import {
  MAX_REELS,
  SPIN_TICK_MAX_PX,
  SPIN_TICK_RANGE,
  SPIN_TICK_START,
  STOP_SPRING_DAMPING,
  STOP_SPRING_MAX_RATIO,
  STOP_SPRING_OSCILLATIONS,
  STOP_SPRING_OVERSHOOT_PX,
  STOP_SPRING_SETTLE_MS,
} from './constants';
import {
  buildSpinPlan,
  getStopSpringOffset,
  updateIdleOffsets,
  updateVelocities,
} from './core/animation';
import {
  normalizeIdleBob,
  normalizeMaxDpr,
  normalizeSpinBlur,
  normalizeSpinConfig,
  normalizeWebGLShading,
} from './normalize';
import { WebGLRenderer } from './render/webglRenderer';
import type {
  ReelDealIdleBob,
  ReelDealOptions,
  ReelDealSpinBlur,
  ReelDealSpinConfig,
  ReelDealSpinState,
  ReelDealWebGLShading,
} from './types';
import { resolveElement } from './utils/dom';
import { clamp01, clampInt, reelProgress } from './utils/math';

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
  private readonly spinConfig: ReturnType<typeof normalizeSpinConfig>;
  private readonly spinBlur: ReelDealSpinBlur;
  private readonly webglShading: ReelDealWebGLShading;
  private readonly idleBob: ReelDealIdleBob | null;
  private readonly maxDpr: number;

  private spriteImg: HTMLImageElement | null = null;
  private spriteWidth = 0;
  private spriteHeight = 0;
  private frameHeight = 0;

  private width = 0;
  private height = 0;
  private dpr = 1;

  private readonly offsets: number[];
  private readonly velocities: number[];
  private lastVelT: number | null = null;
  private readonly lastVelOffsets: number[];
  private idleStartTime: number | null = null;
  private readonly idleBaseOffsets: number[];

  private renderer: WebGLRenderer | null = null;

  private anim: SpinAnimation | null = null;
  private rafId: number | null = null;
  private pendingSpinResolvers: Array<() => void> = [];

  private resizeObserver: ResizeObserver | null = null;
  private resizeQueued = false;

  private button: HTMLButtonElement | null = null;
  private buttonHandlerAttached = false;
  private spinning = false;
  private queuedSpins: ReelDealSpinState[] | null = null;
  private spinIndex = 0;

  constructor(options: ReelDealOptions) {
    this.opts = options;
    this.reels = clampInt(options.reels ?? 1, 1, MAX_REELS);
    this.spinConfig = normalizeSpinConfig(options.spinConfig);
    this.spinBlur = normalizeSpinBlur();
    this.webglShading = normalizeWebGLShading();
    this.idleBob = normalizeIdleBob();
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

    this.renderer = new WebGLRenderer();
    this.renderer.init({
      canvas: this.canvas,
      spriteImg: this.spriteImg as HTMLImageElement,
      spriteWidth: this.spriteWidth,
      spriteHeight: this.spriteHeight,
      frameHeight: this.frameHeight,
      reels: this.reels,
      visibleSlots: this.visibleSlots,
      heightScale: this.heightScale,
      spinBlur: this.spinBlur,
      webglShading: this.webglShading,
    });

    this.syncContainerLayoutVars();
    this.ensureCanvasCoversContainer();
    this.setupResizeWatcher();
    this.resizeToContainer();

    this.setSegments(this.opts.initialSegments);

    this.button = this.resolveButton();
    this.queuedSpins = this.resolveSpinQueue();
    this.setButtonDisabled(!this.queuedSpins || this.queuedSpins.length === 0);

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

  spinOnce(stopAtSegments: number[], config?: Partial<ReelDealSpinConfig>): Promise<void> {
    this.ensureReady();

    const spinConfig = this.getSpinConfig(config);
    const useSpeed = (spinConfig.speedPxS ?? 0) > 0;
    const stopSpringOvershootPx = this.getStopSpringOvershootPx();
    const stopSpringSettleMs = Math.max(0, STOP_SPRING_SETTLE_MS);

    const plan = buildSpinPlan({
      stopAtSegments,
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

    return new Promise((resolve) => {
      this.pendingSpinResolvers.push(resolve);
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

    const spin = this.consumeNextSpin();

    if (!spin) {
      this.setButtonDisabled(true);

      return;
    }

    this.spinning = true;
    this.setButtonDisabled(true);

    try {
      await this.spinOnce(spin.stopAtSegments);
      spin.callback?.(this.spinIndex, spin.stopAtSegments);
      this.spinIndex += 1;
    } finally {
      if (this.queuedSpins && this.queuedSpins.length === 0) {
        this.setButtonDisabled(true);
      } else {
        this.setButtonDisabled(!this.queuedSpins || this.queuedSpins.length === 0);
      }

      this.spinning = false;
    }
  };

  private resolveButton(): HTMLButtonElement | null {
    if (!this.opts.button) return null;

    return resolveElement<HTMLButtonElement>(this.opts.button, 'Button');
  }

  private resolveSpinQueue(): ReelDealSpinState[] | null {
    this.spinIndex = 0;
    return this.opts.queuedSpinStates ?? null;
  }

  private consumeNextSpin(): ReelDealSpinState | null {
    if (!this.queuedSpins) {
      this.queuedSpins = this.resolveSpinQueue();
    }

    if (!this.queuedSpins || this.queuedSpins.length === 0) return null;

    return this.queuedSpins.shift() ?? null;
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
          const t =
            duration <= 0 ? elapsed / settleDuration : (elapsed - duration) / settleDuration;
          const u = clamp01(t);
          const overshoot = startOffsets[r] + deltas[r] - targetOffset;
          const spring = getStopSpringOffset(
            overshoot,
            u,
            STOP_SPRING_DAMPING,
            STOP_SPRING_OSCILLATIONS,
          );

          if (u < 1) allDone = false;

          this.offsets[r] = targetOffset + spring;
        } else {
          this.offsets[r] = targetOffset;
        }
      }

      this.lastVelT = updateVelocities(
        now,
        {
          lastVelT: this.lastVelT,
          lastVelOffsets: this.lastVelOffsets,
          velocities: this.velocities,
        },
        this.offsets,
      );

      this.render();

      if (allDone) {
        for (let r = 0; r < this.reels; r += 1) {
          const targetOffset =
            this.anim.targets[r] ?? this.anim.startOffsets[r] + this.anim.deltas[r];

          this.offsets[r] = targetOffset;
          this.idleBaseOffsets[r] = this.offsets[r];
        }

        this.lastVelT = updateVelocities(
          now,
          {
            lastVelT: this.lastVelT,
            lastVelOffsets: this.lastVelOffsets,
            velocities: this.velocities,
          },
          this.offsets,
        );

        for (let r = 0; r < this.reels; r += 1) {
          this.velocities[r] = 0;
        }

        this.anim = null;
        this.idleStartTime = null;

        this.render();
        this.resolvePendingSpins();
      }
    } else if (this.idleBob) {
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
    if (!this.renderer) return;

    this.renderer.render({
      offsets: this.offsets,
      velocities: this.velocities,
      dpr: this.dpr,
    });
  }

  private async loadSprite(): Promise<void> {
    const loaded = await loadSprite(this.opts.sprite, this.opts.slotCount);

    this.spriteImg = loaded.image;
    this.spriteWidth = loaded.spriteWidth;
    this.frameHeight = loaded.frameHeight;
    this.spriteHeight = loaded.spriteHeight;
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
}
