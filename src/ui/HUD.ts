import './hud.css';

const KEY_ICON =
  '<svg viewBox="0 0 28 12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 6h16M21 6v4M25 6v3" stroke="currentColor" stroke-width="2" fill="none"/></svg>';
const EYE_ICON =
  '<svg viewBox="0 0 48 24" aria-hidden="true"><path class="lid" d="M2 12Q24 -8 46 12Q24 32 2 12Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="24" cy="12" r="5.5" fill="currentColor"/></svg>';

const fmtTime = (s: number): string => {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

/** In-game heads-up display. Everything here is DOM, layered over the canvas. */
export class HUD {
  private readonly root: HTMLElement;
  private readonly batteryBar: HTMLElement;
  private readonly batteryFill: HTMLElement;
  private readonly staminaFill: HTMLElement;
  private readonly noiseFill: HTMLElement;
  private readonly keysEl: HTMLElement;
  private readonly livesEl: HTMLElement;
  private readonly nightEl: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly eye: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly blinkEl: HTMLElement;
  private readonly hiddenEl: HTMLElement;
  private readonly debug: HTMLElement;
  private toastTimer = 0;
  private bannerTimer = 0;
  private lastPrompt = '';
  private lastTime = '';

  constructor() {
    const root = document.createElement('div');
    root.id = 'hud';
    root.className = 'off';
    root.innerHTML = `
      <div class="hidden-frame"></div>
      <div class="crosshair"></div>
      <div class="top">
        <div class="night"></div>
        <div class="eye">${EYE_ICON}</div>
        <div class="right"><span class="lives"></span><span class="time">0:00</span></div>
      </div>
      <div class="bars">
        <div><label>BATTERY</label><div class="bar battery"><i></i></div></div>
        <div><label>STAMINA</label><div class="bar stamina"><i></i></div></div>
        <div><label>NOISE</label><div class="bar noise"><i></i></div></div>
      </div>
      <div class="keys"></div>
      <div class="prompt"></div>
      <div class="toast"></div>
      <div class="banner"><small></small><h2></h2><p></p></div>
      <div class="debug"></div>
      <div class="blink"></div>`;
    document.body.appendChild(root);
    this.root = root;

    const q = (sel: string): HTMLElement => root.querySelector(sel)!;
    this.batteryBar = q('.bar.battery');
    this.batteryFill = q('.bar.battery i');
    this.staminaFill = q('.bar.stamina i');
    this.noiseFill = q('.bar.noise i');
    this.keysEl = q('.keys');
    this.livesEl = q('.lives');
    this.nightEl = q('.night');
    this.timeEl = q('.time');
    this.eye = q('.eye');
    this.prompt = q('.prompt');
    this.toastEl = q('.toast');
    this.banner = q('.banner');
    this.blinkEl = q('.blink');
    this.hiddenEl = q('.hidden-frame');
    this.debug = q('.debug');
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('off', !visible);
  }

  setNight(id: number, name: string): void {
    this.nightEl.textContent = `NIGHT ${id} · ${name.toUpperCase()}`;
  }

  setBattery(pct: number): void {
    this.batteryFill.style.width = `${pct}%`;
    this.batteryBar.classList.toggle('low', pct < 20);
  }

  setStamina(pct: number): void {
    this.staminaFill.style.width = `${pct}%`;
  }

  /** `level` 0..1 */
  setNoise(level: number): void {
    this.noiseFill.style.width = `${Math.min(1, level) * 100}%`;
    this.noiseFill.style.background = level > 0.6 ? '#b03a2e' : level > 0.25 ? '#d8b45a' : '#6f8f6f';
  }

  setKeys(have: number, total: number): void {
    this.keysEl.innerHTML = Array.from(
      { length: total },
      (_, i) => `<span class="${i < have ? 'have' : ''}">${KEY_ICON}</span>`,
    ).join('');
    this.keysEl.classList.toggle('all', have >= total);
  }

  setLives(left: number, total: number): void {
    this.livesEl.innerHTML = Array.from(
      { length: total },
      (_, i) => `<i class="${i < left ? '' : 'lost'}"></i>`,
    ).join('');
  }

  setTime(seconds: number): void {
    const text = fmtTime(seconds);
    if (text !== this.lastTime) this.timeEl.textContent = this.lastTime = text;
  }

  /** `alert` 0..1 — how close she is to finding you; `hunting` once she has. */
  setThreat(alert: number, hunting: boolean): void {
    this.eye.style.opacity = String(Math.min(1, 0.12 + alert * 1.2));
    this.eye.style.transform = `scaleY(${0.25 + Math.min(1, alert * 1.3) * 0.75})`;
    this.eye.classList.toggle('wary', alert > 0.3 && !hunting);
    this.eye.classList.toggle('hunt', hunting);
  }

  setHidden(hidden: boolean): void {
    this.hiddenEl.classList.toggle('on', hidden);
  }

  setPrompt(text: string | null): void {
    const t = text ?? '';
    if (t !== this.lastPrompt) this.prompt.textContent = this.lastPrompt = t;
  }

  setDebug(text: string | null): void {
    this.debug.textContent = text ?? '';
  }

  /** Short message under the centre of the screen. */
  toast(text: string, warn = false): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.toggle('warn', warn);
    this.toastEl.classList.add('on');
    this.toastTimer = 3.2;
  }

  /** Title card at the start of a night. */
  showBanner(kicker: string, title: string, text: string): void {
    this.banner.querySelector('small')!.textContent = kicker;
    this.banner.querySelector('h2')!.textContent = title;
    this.banner.querySelector('p')!.textContent = text;
    this.banner.classList.add('on');
    this.bannerTimer = 5;
  }

  /** A quick blackout to cover a camera cut (climbing in or out of a wardrobe). */
  blink(): void {
    this.blinkEl.classList.remove('go');
    void this.blinkEl.offsetWidth; // restart the animation
    this.blinkEl.classList.add('go');
  }

  update(dt: number): void {
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toastEl.classList.remove('on');
    if (this.bannerTimer > 0 && (this.bannerTimer -= dt) <= 0) this.banner.classList.remove('on');
  }

  clearMessages(): void {
    this.toastTimer = this.bannerTimer = 0;
    this.toastEl.classList.remove('on');
    this.banner.classList.remove('on');
    this.setPrompt(null);
    this.setHidden(false);
  }
}

export { fmtTime };
