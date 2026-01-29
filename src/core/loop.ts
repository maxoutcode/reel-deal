export type RafStep = (now: number) => boolean | undefined;

export class RafLoop {
  private rafId: number | null = null;
  private step: RafStep | null = null;
  private abortListener: (() => void) | null = null;

  start(step: RafStep, signal?: AbortSignal): void {
    if (this.rafId !== null) return;

    this.step = step;
    this.attachAbort(signal);
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);

      this.rafId = null;
    }

    this.step = null;
    this.detachAbort();
  }

  isRunning(): boolean {
    return this.rafId !== null;
  }

  private tick = (now: number): void => {
    if (!this.step) {
      this.stop();

      return;
    }

    const shouldContinue = this.step(now);

    if (shouldContinue === false) {
      this.stop();

      return;
    }

    if (this.rafId === null) return;

    this.rafId = requestAnimationFrame(this.tick);
  };

  private attachAbort(signal?: AbortSignal): void {
    if (!signal) return;
    if (signal.aborted) {
      this.stop();

      return;
    }

    const onAbort = (): void => {
      this.stop();
    };

    signal.addEventListener('abort', onAbort, { once: true });

    this.abortListener = () => signal.removeEventListener('abort', onAbort);
  }

  private detachAbort(): void {
    if (this.abortListener) {
      this.abortListener();
    }

    this.abortListener = null;
  }
}
