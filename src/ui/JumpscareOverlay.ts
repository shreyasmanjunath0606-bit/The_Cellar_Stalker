/** Full-screen blood vignette, impact strobe and fade-to-black for the catch sequence. */
export class JumpscareOverlay {
  private readonly el: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly blood: HTMLElement;
  private readonly black: HTMLElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'jumpscare';
    this.el.innerHTML = '<div class="blood"></div><div class="flash"></div><div class="black"></div>';
    document.body.appendChild(this.el);
    this.blood = this.el.querySelector('.blood')!;
    this.flash = this.el.querySelector('.flash')!;
    this.black = this.el.querySelector('.black')!;
    this.set(0);
  }

  /** `progress` 0..1 through the attack; 0 hides everything. */
  set(progress: number): void {
    this.el.style.display = progress > 0 ? 'block' : 'none';
    if (progress <= 0) return;
    this.blood.style.opacity = String(Math.min(1, progress * 3));
    this.flash.style.opacity = progress < 0.3 && Math.floor(progress * 45) % 2 === 0 ? '0.6' : '0';
    this.black.style.opacity = String(Math.max(0, (progress - 0.8) / 0.2));
  }
}
