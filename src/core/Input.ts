export class Input {
  mouseDX = 0;
  mouseDY = 0;
  locked = false;
  onLockChange: (locked: boolean) => void = () => {};

  private down = new Set<string>();
  private pressed = new Set<string>();

  constructor(private readonly el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
      if (this.locked && e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('mousedown', (e) => {
      if (this.locked) this.pressed.add(`Mouse${e.button}`);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) this.down.clear();
      this.onLockChange(this.locked);
    });
  }

  requestLock(): void {
    // browsers reject (or throw) if the lock is re-requested too soon after Esc; the player just clicks again
    try {
      Promise.resolve(this.el.requestPointerLock()).catch(() => {});
    } catch {
      /* ignored */
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
