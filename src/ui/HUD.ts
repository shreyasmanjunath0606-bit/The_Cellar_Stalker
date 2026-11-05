import './hud.css';

export class HUD {
  private readonly batteryBar: HTMLElement;
  private readonly batteryFill: HTMLElement;
  private readonly staminaFill: HTMLElement;
  private readonly keysEl: HTMLElement;
  private readonly noiseFill: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly debug: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;

  constructor(onStart: () => void) {
    const root = document.createElement('div');
    root.id = 'hud';
    root.innerHTML = `
      <div class="crosshair"></div>
      <div class="bars">
        <div>BATTERY<div class="bar battery"><i></i></div></div>
        <div>STAMINA<div class="bar stamina"><i></i></div></div>
        <div>NOISE<div class="bar noise"><i></i></div></div>
      </div>
      <div class="prompt"></div>
      <div class="debug"></div>
      <div class="keys"></div>
      <div class="overlay">
        <h1>THE CELLAR STALKER</h1>
        <p class="subtitle">CLICK TO BEGIN</p>
        <p>WASD move · SHIFT sprint · C crouch · F flashlight · MOUSE look</p>
        <p>Find 3 keys. Open the cellar door. Don't make a sound.</p>
      </div>`;
    document.body.appendChild(root);

    this.batteryBar = root.querySelector('.bar.battery')!;
    this.batteryFill = this.batteryBar.querySelector('i')!;
    this.staminaFill = root.querySelector('.bar.stamina i')!;
    this.keysEl = root.querySelector('.keys')!;
    this.noiseFill = root.querySelector('.bar.noise i')!;
    this.prompt = root.querySelector('.prompt')!;
    this.debug = root.querySelector('.debug')!;
    this.overlay = root.querySelector('.overlay')!;
    this.title = root.querySelector('h1')!;
    this.subtitle = root.querySelector('.subtitle')!;
    this.overlay.addEventListener('click', onStart);
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

  setDebug(text: string | null): void {
    this.debug.textContent = text ?? '';
  }

  setPrompt(text: string | null): void {
    this.prompt.textContent = text ?? '';
  }

  setKeys(have: number, total: number): void {
    this.keysEl.textContent = `KEYS ${have}/${total}`;
  }

  showOverlay(visible: boolean, title = 'THE CELLAR STALKER', subtitle = 'CLICK TO BEGIN'): void {
    this.overlay.classList.toggle('hidden', !visible);
    this.title.textContent = title;
    this.subtitle.textContent = subtitle;
  }
}
