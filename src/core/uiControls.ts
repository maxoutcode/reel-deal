type SpinHandler = () => Promise<void>;

export class SpinUiController {
  private readonly button: HTMLButtonElement | null;
  private readonly handler: SpinHandler;
  private attached = false;
  private spinning = false;
  private hasQueue = false;

  constructor(button: HTMLButtonElement | null, handler: SpinHandler) {
    this.button = button;
    this.handler = handler;
    this.attach();
  }

  updateAvailability(hasQueue: boolean): void {
    this.hasQueue = hasQueue;

    if (!this.button) return;

    this.setDisabled(this.spinning || !this.hasQueue);
  }

  dispose(): void {
    if (this.button && this.attached) {
      this.button.removeEventListener('click', this.onClick);
      this.attached = false;
    }

    this.spinning = false;
  }

  private attach(): void {
    if (!this.button || this.attached) return;

    this.button.addEventListener('click', this.onClick, { passive: true });
    this.attached = true;
  }

  private setDisabled(disabled: boolean): void {
    if (!this.button) return;

    this.button.disabled = disabled;

    if (disabled) this.button.setAttribute('aria-busy', 'true');
    else this.button.removeAttribute('aria-busy');
  }

  private onClick = async (): Promise<void> => {
    if (this.spinning) return;

    this.spinning = true;
    this.setDisabled(true);

    try {
      await this.handler();
    } finally {
      this.spinning = false;
      this.setDisabled(!this.hasQueue);
    }
  };
}
