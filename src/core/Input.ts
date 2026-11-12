/** Largest single mouse delta we believe; browsers occasionally report a huge bogus jump under pointer lock. */
const SPIKE = 350;

export class Input {
  mouseDX = 0;
  mouseDY = 0;
  locked = false;
  onLockChange: (locked: boolean) => void = () => {};

  private down = new Set<string>();
  private pressed = new Set<string>();
  /** Raw (unaccelerated) mouse input is tried first; some browsers / devices refuse it. */
  private rawSupported = true;

  constructor(private readonly el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
      if (this.locked && (e.code.startsWith('Arrow') || e.code === 'Tab' || e.code === 'Space')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('mousedown', (e) => {
      if (this.locked) this.pressed.add(`Mouse${e.button}`);
    });
    // Mouse deltas are accumulated the moment they arrive and are never tied to the keyboard state,
    // so looking and walking are fully independent.
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const dx = e.movementX || 0;
      const dy = e.movementY || 0;
      if (Math.abs(dx) > SPIKE || Math.abs(dy) > SPIKE) return;
      this.mouseDX += dx;
      this.mouseDY += dy;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) this.down.clear();
      this.mouseDX = this.mouseDY = 0;
      this.onLockChange(this.locked);
    });
  }

  requestLock(): void {
    if (this.locked) return;
    // Raw input bypasses the operating system's pointer acceleration and speed setting, which is what
    // makes the view feel sluggish or uneven. Fall back to a normal lock where it is unsupported.
    const plain = (): void => {
      try {
        Promise.resolve(this.el.requestPointerLock()).catch(() => {});
      } catch {
        /* browsers reject if the lock is re-requested too soon after Esc; the player just clicks again */
      }
    };
    if (!this.rawSupported) return plain();
    try {
      const req = (this.el.requestPointerLock as (o?: { unadjustedMovement: boolean }) => Promise<void> | void)({
        unadjustedMovement: true,
      });
      Promise.resolve(req).catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'NotSupportedError') {
          this.rawSupported = false;
          plain();
        }
      });
    } catch {
      this.rawSupported = false;
      plain();
    }
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  consumeMouse(): { x: number; y: number } {
    const out = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return out;
  }

  endFrame(): void {
    this.pressed.clear();
  }
}
