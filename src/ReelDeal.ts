import { loadSprite } from './assets/spriteLoader';
import {
  MAX_REELS,
  SPIN_FIXED_STEP_MS,
  SPIN_MAX_CATCH_UP_STEPS_PER_FRAME,
  SPIN_MAX_FRAME_DELTA_MS,
  STOP_SPRING_DAMPING,
  STOP_SPRING_MAX_RATIO,
  STOP_SPRING_OSCILLATIONS,
  STOP_SPRING_OVERSHOOT_PX,
  STOP_SPRING_SETTLE_MS,
} from './constants';
import {
  applySpinPlanStep,
  buildSpinPlan,
  updateIdleOffsets,
  updateVelocities,
} from './core/animation';
import { RafLoop } from './core/loop';
import {
  createRuntimeState,
  enterHighlightRuntime,
  enterIdleRuntime,
  resetSpinRuntime,
  setSpinRuntimePhase,
  startSpinRuntime,
} from './core/runtime';
import { SpinQueueController } from './core/spinQueue';
import { SpinUiController } from './core/uiControls';
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
import { clamp01, clampInt } from './utils/math';

type SpinAnimation = {
  startOffsets: number[];
  deltas: number[];
  durationMs: number[];
  settleDurationMs: number[];
  targets: number[];
  elapsedMs: number;
  prevOffsets: number[];
  currOffsets: number[];
};

export class ReelDeal {
  private static readonly HIGHLIGHT_FADE_IN_MS = 220;
  private static readonly COARSE_POINTER_MAX_DPR = 1.5;
  private static readonly PERF_WINDOW_MS = 1500;
  private static readonly PERF_BAD_P95_DT_MS = 19;
  private static readonly PERF_GOOD_P95_DT_MS = 17.5;
  private static readonly PERF_BAD_SLOW_RATIO = 0.03;
  private static readonly PERF_BAD_WINDOWS_TO_DECREASE_DPR = 2;
  private static readonly PERF_GOOD_WINDOWS_TO_INCREASE_DPR = 4;
  private static readonly ADAPTIVE_DPR_MIN = 1.25;
  private static readonly ADAPTIVE_DPR_STEP_DOWN = 0.1;
  private static readonly ADAPTIVE_DPR_STEP_UP = 0.05;

  private readonly canvas: HTMLCanvasElement;
  private readonly container: HTMLElement;

  private readonly opts: ReelDealOptions;
  private readonly visibleSlots = 3;
  private readonly heightScale = 2 / 3;
  private readonly centerIndex = 1;
  private readonly reels: number;
  private readonly spinConfig: Required<ReelDealSpinConfig>;
  private readonly spinBlur: ReelDealSpinBlur;
  private readonly webglShading: ReelDealWebGLShading;
  private readonly idleBob: ReelDealIdleBob | null;
  private readonly maxDpr: number;
  private readonly adaptiveDpr: boolean;
  private readonly isCoarsePointerDevice: boolean;
  private readonly spinQueueController: SpinQueueController;

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
  private readonly runtime = createRuntimeState();
  private readonly rafLoop = new RafLoop();
  private pendingSpinResolvers: Array<() => void> = [];

  private resizeObserver: ResizeObserver | null = null;
  private resizeQueued = false;
  private dprCap = 1;
  private lastFramePerfNow: number | null = null;
  private perfWindowStartedAt = 0;
  private perfFrameCount = 0;
  private perfSlowFrameCount = 0;
  private readonly perfDtSamples: number[] = [];
  private adaptiveDprGoodWindows = 0;
  private adaptiveDprBadWindows = 0;

  private spinUi: SpinUiController | null = null;
  private spinIndex = 0;

  constructor(options: ReelDealOptions) {
    this.opts = options;
    this.reels = clampInt(options.reels ?? 1, 1, MAX_REELS);
    this.spinConfig = normalizeSpinConfig(options.spinConfig);
    this.spinBlur = normalizeSpinBlur(options.spinBlur);
    this.webglShading = normalizeWebGLShading(options.webglShading);
    this.idleBob = normalizeIdleBob(options.idleBob);
    this.maxDpr = normalizeMaxDpr(options.maxDpr);
    this.adaptiveDpr = options.adaptiveDpr !== false;
    this.isCoarsePointerDevice = ReelDeal.detectCoarsePointerDevice();
    this.dprCap = this.isCoarsePointerDevice
      ? Math.min(this.maxDpr, ReelDeal.COARSE_POINTER_MAX_DPR)
      : this.maxDpr;

    this.canvas = resolveElement<HTMLCanvasElement>(options.canvas, 'Canvas');
    this.container = resolveElement<HTMLElement>(options.container, 'Container');
    this.spinQueueController = new SpinQueueController({
      slotCount: options.slotCount,
      reels: this.reels,
      initialQueue: options.queuedSpinStates ?? null,
    });

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

    this.spinIndex = 0;
    this.spinUi = new SpinUiController(this.resolveButton(), this.handleQueuedSpin);
    this.updateSpinAvailability();

    this.render();
    this.startLoop();
  }

  destroy(): void {
    this.stop();

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.spinUi) this.spinUi.dispose();
    this.spinUi = null;

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
  }

  async spin(spin?: ReelDealSpinState | number[]): Promise<void> {
    if (this.anim) {
      throw new Error('Spin is already in progress.');
    }

    if (spin) {
      await this.playSpinState(this.normalizeSpinState(spin));
      this.updateSpinAvailability();
      return;
    }

    const queuedSpin = this.spinQueueController.consume();

    if (!queuedSpin) {
      this.updateSpinAvailability();
      return;
    }

    try {
      await this.playSpinState(queuedSpin);
    } finally {
      this.updateSpinAvailability();
    }
  }

  enqueueSpin(spin: ReelDealSpinState | ReelDealSpinState[]): void {
    this.spinQueueController.enqueue(spin);
    if (this.anim === null) {
      this.enterRestPhase(performance.now());
    }
    this.updateSpinAvailability();
    this.startLoop();
  }

  clearQueuedSpins(): void {
    this.spinQueueController.clear();
    if (this.anim === null) {
      this.enterRestPhase(performance.now());
    }
    this.updateSpinAvailability();
  }

  hasPendingSpins(): boolean {
    return this.spinQueueController.hasPending();
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

  private setSegments(initialSegments?: number[]): void {
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
    resetSpinRuntime(this.runtime);

    this.stop();
    this.enterRestPhase(performance.now());
    this.render();
    this.startLoop();
  }

  private spinOnce(stopAtSegments: number[]): Promise<void> {
    this.ensureReady();

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
      spinConfig: this.spinConfig,
      stopSpringOvershootPx,
      stopSpringSettleMs,
    });

    if (plan.totalDelta === 0 || (plan.allSpinZero && plan.allSettleZero)) {
      for (let r = 0; r < this.reels; r += 1) {
        this.offsets[r] = plan.targets[r];
        this.idleBaseOffsets[r] = plan.targets[r];
      }

      this.anim = null;
      this.enterRestPhase(performance.now());

      this.resolvePendingSpins();
      this.render();

      return Promise.resolve();
    }

    this.anim = {
      startOffsets: plan.startOffsets,
      deltas: plan.deltas,
      durationMs: plan.durations,
      settleDurationMs: plan.settleDurationMs,
      targets: plan.targets,
      elapsedMs: 0,
      prevOffsets: [...plan.startOffsets],
      currOffsets: [...plan.startOffsets],
    };
    this.idleStartTime = null;
    startSpinRuntime(this.runtime);

    this.startLoop();

    return new Promise((resolve) => {
      this.pendingSpinResolvers.push(resolve);
    });
  }

  private getStopSpringOvershootPx(): number {
    const cap = this.frameHeight * STOP_SPRING_MAX_RATIO;
    const overshoot = Math.max(0, STOP_SPRING_OVERSHOOT_PX) * this.getSpritePxPerCssPx();

    return Math.min(overshoot, cap);
  }

  private getSymbolCssHeightPx(): number {
    const slotsViewport = this.visibleSlots * this.heightScale;

    if (slotsViewport <= 0) return this.frameHeight;

    return this.height > 0 ? this.height / slotsViewport : this.frameHeight;
  }

  private getSpritePxPerCssPx(): number {
    const symbolCssHeight = this.getSymbolCssHeightPx();

    if (this.frameHeight <= 0 || symbolCssHeight <= 0) return 1;

    return this.frameHeight / symbolCssHeight;
  }

  private stop(): void {
    this.rafLoop.stop();
    this.anim = null;
    this.resolvePendingSpins();
    this.lastVelT = null;
    this.lastFramePerfNow = null;
    this.resetAdaptiveDprWindow();

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

  private resolveButton(): HTMLButtonElement | null {
    if (!this.opts.button) return null;

    return resolveElement<HTMLButtonElement>(this.opts.button, 'Button');
  }

  private normalizeSpinState(spin: ReelDealSpinState | number[]): ReelDealSpinState {
    const rawStops = Array.isArray(spin) ? spin : spin.stopAtSegments;
    const stopAtSegments = new Array(this.reels);

    for (let r = 0; r < this.reels; r += 1) {
      stopAtSegments[r] = clampInt(rawStops[r] ?? 0, 0, this.opts.slotCount - 1);
    }

    return {
      stopAtSegments,
      callback: Array.isArray(spin) ? undefined : spin.callback,
    };
  }

  private async playSpinState(spin: ReelDealSpinState): Promise<void> {
    await this.spinOnce(spin.stopAtSegments);

    spin.callback?.(this.spinIndex, spin.stopAtSegments);
    this.spinIndex += 1;
  }

  private updateSpinAvailability(): void {
    this.spinUi?.updateAvailability(this.spinQueueController.hasPending());
  }

  private enterRestPhase(now: number): void {
    const shouldHighlight =
      this.webglShading.highlightEnabled !== false &&
      (this.webglShading.highlightIntensity ?? 0) > 0 &&
      !this.spinQueueController.hasPending();

    if (shouldHighlight) {
      enterHighlightRuntime(this.runtime, now);
      return;
    }

    enterIdleRuntime(this.runtime);
  }

  private copyOffsets(target: number[], source: ArrayLike<number>): void {
    for (let r = 0; r < this.reels; r += 1) {
      target[r] = source[r] ?? 0;
    }
  }

  private applyInterpolatedSpinOffsets(alpha: number): void {
    if (!this.anim) return;

    for (let r = 0; r < this.reels; r += 1) {
      const prev = this.anim.prevOffsets[r] ?? 0;
      const curr = this.anim.currOffsets[r] ?? prev;

      this.offsets[r] = prev + (curr - prev) * alpha;
    }
  }

  private advanceSpinSimulation(now: number): boolean {
    if (!this.anim) return true;

    if (this.runtime.spinLastNow === null) {
      this.runtime.spinLastNow = now;
      this.applyInterpolatedSpinOffsets(1);
      return false;
    }

    const frameDt = Math.max(0, Math.min(now - this.runtime.spinLastNow, SPIN_MAX_FRAME_DELTA_MS));

    this.runtime.spinLastNow = now;
    this.runtime.spinAccumulatorMs += frameDt;

    let allDone = false;
    let steps = 0;

    while (
      this.runtime.spinAccumulatorMs >= SPIN_FIXED_STEP_MS &&
      steps < SPIN_MAX_CATCH_UP_STEPS_PER_FRAME &&
      this.anim
    ) {
      this.copyOffsets(this.anim.prevOffsets, this.anim.currOffsets);
      this.anim.elapsedMs += SPIN_FIXED_STEP_MS;

      const step = applySpinPlanStep({
        elapsedMs: this.anim.elapsedMs,
        offsets: this.anim.currOffsets,
        startOffsets: this.anim.startOffsets,
        deltas: this.anim.deltas,
        durationMs: this.anim.durationMs,
        settleDurationMs: this.anim.settleDurationMs,
        targets: this.anim.targets,
        frameHeight: this.frameHeight,
        spritePxPerCssPx: this.getSpritePxPerCssPx(),
        stopSpringDamping: STOP_SPRING_DAMPING,
        stopSpringOscillations: STOP_SPRING_OSCILLATIONS,
      });

      if (step.phase) {
        setSpinRuntimePhase(this.runtime, step.phase);
      }

      this.runtime.spinAccumulatorMs -= SPIN_FIXED_STEP_MS;
      steps += 1;

      if (step.allDone) {
        allDone = true;
        break;
      }
    }

    if (allDone) {
      this.applyInterpolatedSpinOffsets(1);
      return true;
    }

    this.applyInterpolatedSpinOffsets(clamp01(this.runtime.spinAccumulatorMs / SPIN_FIXED_STEP_MS));
    return false;
  }

  private completeSpinAnimation(now: number): void {
    if (!this.anim) return;

    for (let r = 0; r < this.reels; r += 1) {
      const targetOffset = this.anim.targets[r] ?? this.anim.startOffsets[r] + this.anim.deltas[r];

      this.offsets[r] = targetOffset;
      this.idleBaseOffsets[r] = targetOffset;
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
    this.enterRestPhase(now);
    this.render();
    this.resolvePendingSpins();
  }

  private handleQueuedSpin = async (): Promise<void> => {
    await this.spin();
  };

  private shouldAnimate(): boolean {
    if (this.anim !== null) return true;
    if (this.runtime.phase === 'highlight') return true;
    return this.runtime.phase === 'idle' && this.idleBob !== null;
  }

  private startLoop(): void {
    if (this.rafLoop.isRunning()) return;
    if (!this.shouldAnimate()) return;

    this.rafLoop.start(this.loopStep);
  }

  private loopStep = (now: number): boolean => {
    this.trackAdaptiveDpr(now);

    if (this.anim) {
      const allDone = this.advanceSpinSimulation(now);

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
        this.completeSpinAnimation(now);
      }
    } else {
      if (this.runtime.phase === 'idle' && this.idleBob) {
        const idleBobScaled = {
          ...this.idleBob,
          amplitudePx: this.idleBob.amplitudePx * this.getSpritePxPerCssPx(),
        };

        this.idleStartTime = updateIdleOffsets(
          now,
          {
            idleStartTime: this.idleStartTime,
            idleBaseOffsets: this.idleBaseOffsets,
            velocities: this.velocities,
          },
          idleBobScaled,
          this.offsets,
          this.reels,
        );
      }

      this.render();
    }

    if (!this.shouldAnimate()) {
      return false;
    }

    return true;
  };

  private render(): void {
    if (!this.spriteImg) return;
    if (this.width <= 0 || this.height <= 0) return;
    if (!this.renderer) return;

    const now = performance.now();
    const highlightActive = this.runtime.phase === 'highlight';

    const highlightFade =
      !highlightActive || this.runtime.highlightStartedAt === null
        ? 0
        : clamp01((now - this.runtime.highlightStartedAt) / ReelDeal.HIGHLIGHT_FADE_IN_MS);

    this.renderer.render({
      offsets: this.offsets,
      velocities: this.velocities,
      dpr: this.dpr,
      highlightActive,
      highlightFade,
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

    return Math.min(this.maxDpr, this.dprCap, base);
  }

  private trackAdaptiveDpr(now: number): void {
    if (!this.adaptiveDpr || !this.isCoarsePointerDevice) return;

    if (this.lastFramePerfNow === null) {
      this.lastFramePerfNow = now;
      this.resetAdaptiveDprWindow();
      return;
    }

    const dt = Math.min(Math.max(0, now - this.lastFramePerfNow), 50);

    this.lastFramePerfNow = now;

    if (this.anim === null) {
      this.resetAdaptiveDprWindow();
      return;
    }

    if (this.perfWindowStartedAt <= 0) this.perfWindowStartedAt = now;

    this.perfFrameCount += 1;
    if (dt > 20) this.perfSlowFrameCount += 1;
    this.perfDtSamples.push(dt);

    if (now - this.perfWindowStartedAt < ReelDeal.PERF_WINDOW_MS) return;

    this.flushAdaptiveDprWindow();
    this.perfWindowStartedAt = now;
  }

  private resetAdaptiveDprWindow(): void {
    this.perfWindowStartedAt = 0;
    this.perfFrameCount = 0;
    this.perfSlowFrameCount = 0;
    this.perfDtSamples.length = 0;
    this.adaptiveDprGoodWindows = 0;
    this.adaptiveDprBadWindows = 0;
  }

  private flushAdaptiveDprWindow(): void {
    if (this.perfFrameCount === 0) return;

    const sorted = [...this.perfDtSamples].sort((a, b) => a - b);
    const p95Index = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95)));
    const p95Dt = sorted[p95Index];

    this.adjustAdaptiveDprCap(p95Dt, this.perfSlowFrameCount, this.perfFrameCount);
    this.perfFrameCount = 0;
    this.perfSlowFrameCount = 0;
    this.perfDtSamples.length = 0;
  }

  private adjustAdaptiveDprCap(p95Dt: number, slowFrames: number, totalFrames: number): void {
    if (totalFrames <= 0) return;

    const slowRatio = slowFrames / totalFrames;
    const isBadWindow =
      p95Dt > ReelDeal.PERF_BAD_P95_DT_MS || slowRatio > ReelDeal.PERF_BAD_SLOW_RATIO;
    const isGoodWindow = p95Dt <= ReelDeal.PERF_GOOD_P95_DT_MS && slowFrames === 0;
    let nextCap = this.dprCap;

    if (isBadWindow) {
      this.adaptiveDprBadWindows += 1;
      this.adaptiveDprGoodWindows = 0;

      if (this.adaptiveDprBadWindows >= ReelDeal.PERF_BAD_WINDOWS_TO_DECREASE_DPR) {
        nextCap = Math.max(
          ReelDeal.ADAPTIVE_DPR_MIN,
          this.dprCap - ReelDeal.ADAPTIVE_DPR_STEP_DOWN,
        );
        this.adaptiveDprBadWindows = 0;
      }
    } else if (isGoodWindow) {
      this.adaptiveDprGoodWindows += 1;
      this.adaptiveDprBadWindows = 0;

      if (this.adaptiveDprGoodWindows >= ReelDeal.PERF_GOOD_WINDOWS_TO_INCREASE_DPR) {
        nextCap = Math.min(this.maxDpr, this.dprCap + ReelDeal.ADAPTIVE_DPR_STEP_UP);
        this.adaptiveDprGoodWindows = 0;
      }
    } else {
      this.adaptiveDprGoodWindows = 0;
      this.adaptiveDprBadWindows = 0;
    }

    if (Math.abs(nextCap - this.dprCap) < 0.001) return;

    this.dprCap = nextCap;
    this.resizeToContainer();
  }

  private static detectCoarsePointerDevice(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches
    );
  }
}
