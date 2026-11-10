import { LEVELS } from '../core/Levels';
import type { Progress, Quality, Settings } from '../core/Save';
import { fmtTime } from './HUD';

export type Screen =
  | 'main' | 'nights' | 'howto' | 'settings'
  | 'pause' | 'intro' | 'caught' | 'gameover' | 'complete' | 'victory';

export type MenuAction = 'continue' | 'new' | 'play' | 'resume' | 'lock' | 'restart' | 'next' | 'quit';

export interface MenuHost {
  progress(): Progress;
  settings(): Settings;
  /** Called on every button press, before the action runs (starts audio, plays the tick). */
  touched(): void;
  act(action: MenuAction, arg?: string): void;
  applySettings(s: Settings): void;
}

/** What the result / status screens need to know. */
export interface ScreenData {
  night?: number;
  time?: number;
  best?: number;
  newBest?: boolean;
  catches?: number;
  livesLeft?: number;
}

const VERSION = 'v1.0';
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const btn = (act: string, label: string, cls = ''): string =>
  `<button type="button" class="${cls}" data-act="${act}">${label}</button>`;

/** Every full-screen menu: title, night select, settings, pause and the result cards. */
export class Menu {
  private readonly root: HTMLElement;
  private screen: Screen | null = null;
  private data: ScreenData = {};
  private parent: Screen = 'main';

  constructor(private readonly host: MenuHost) {
    this.root = document.createElement('div');
    this.root.id = 'menu';
    document.body.appendChild(this.root);

    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!el || (el as HTMLButtonElement).disabled) return;
      this.host.touched();
      this.run(el.dataset.act!, el.dataset.arg);
    });
    this.root.addEventListener('input', (e) => this.onInput(e.target as HTMLInputElement));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.screen && ['nights', 'howto', 'settings'].includes(this.screen)) {
        this.show(this.parent, this.data);
      }
    });
  }

  get current(): Screen | null {
    return this.screen;
  }

  show(screen: Screen, data: ScreenData = {}): void {
    this.screen = screen;
    this.data = data;
    this.root.className = `on screen-${screen}`;
    this.root.innerHTML = this.render(screen, data);
    this.root.querySelector<HTMLElement>('button.primary')?.focus({ preventScroll: true });
  }

  hide(): void {
    this.screen = null;
    this.root.className = '';
    this.root.innerHTML = '';
  }

  private run(act: string, arg?: string): void {
    switch (act) {
      case 'nights':
      case 'howto':
      case 'settings':
        this.parent = this.screen === 'pause' ? 'pause' : 'main';
        this.show(act, this.data);
        break;
      case 'back':
        this.show(this.parent, this.data);
        break;
      case 'quality': {
        const s = { ...this.host.settings(), quality: arg as Quality };
        this.host.applySettings(s);
        this.show('settings', this.data);
        break;
      }
      default:
        this.host.act(act as MenuAction, arg);
    }
  }

  private onInput(el: HTMLInputElement): void {
    const s = { ...this.host.settings() };
    if (el.name === 'sensitivity') s.sensitivity = Number(el.value);
    else if (el.name === 'volume') s.volume = Number(el.value);
    else return;
    this.host.applySettings(s);
    const out = el.parentElement?.querySelector('output');
    if (out) out.textContent = el.name === 'volume' ? `${Math.round(s.volume * 100)}%` : `${s.sensitivity.toFixed(1)}×`;
  }

  private render(screen: Screen, d: ScreenData): string {
    const level = LEVELS[(d.night ?? 1) - 1];
    switch (screen) {
      case 'main': {
        const p = this.host.progress();
        const cont = p.unlocked > 1
          ? btn('continue', `Continue <em>Night ${p.unlocked} — ${esc(LEVELS[p.unlocked - 1].name)}</em>`, 'primary')
          : '';
        return `
          <div class="panel main">
            <p class="kicker">A stealth horror in five nights</p>
            <h1>THE CELLAR<br><span>STALKER</span></h1>
            <nav>
              ${cont}
              ${btn('new', p.unlocked > 1 ? 'New Game' : 'Begin', p.unlocked > 1 ? '' : 'primary')}
              ${btn('nights', 'Select Night')}
              ${btn('howto', 'How to Play')}
              ${btn('settings', 'Settings')}
            </nav>
            ${p.finished ? '<p class="note">You have survived all five nights.</p>' : ''}
          </div>
          <footer>${VERSION} · Best played with headphones, in the dark.</footer>`;
      }
      case 'nights': {
        const p = this.host.progress();
        const cards = LEVELS.map((l) => {
          const open = l.id <= p.unlocked;
          const best = p.best[l.id];
          return `
            <button type="button" class="night-card" data-act="play" data-arg="${l.id}" ${open ? '' : 'disabled'}>
              <small>NIGHT ${l.id}</small>
              <strong>${open ? esc(l.name) : '— locked —'}</strong>
              <span>${open ? `${l.keys} keys · ${l.stalkers > 1 ? 'two of them' : l.lives + ' chances'}` : 'Survive the night before'}</span>
              <span class="best">${best ? `Best ${fmtTime(best)}` : open ? 'Not yet escaped' : ''}</span>
            </button>`;
        }).join('');
        return `
          <div class="panel wide">
            <h2>Select Night</h2>
            <div class="nights">${cards}</div>
            <nav class="row">${btn('back', 'Back')}</nav>
          </div>`;
      }
      case 'howto':
        return `
          <div class="panel wide">
            <h2>How to Play</h2>
            <div class="cols">
              <dl class="controls">
                <dt>W A S D</dt><dd>Move</dd>
                <dt>Mouse</dt><dd>Look</dd>
                <dt>Shift</dt><dd>Sprint — loud, and it drains stamina</dd>
                <dt>C</dt><dd>Crouch — slow, quiet, harder to see</dd>
                <dt>F</dt><dd>Flashlight — she sees the light from further away</dd>
                <dt>E</dt><dd>Take · hide · unlock</dd>
                <dt>Click</dt><dd>Shove an object to make noise somewhere else</dd>
                <dt>Esc</dt><dd>Pause</dd>
              </dl>
              <ul class="tips">
                <li>Find every key, then unlock the cellar door at the south end of the hall.</li>
                <li>She hunts by sound. Watch the <b>NOISE</b> bar; dark patches of floor creak.</li>
                <li>The eye at the top opens as she notices you. Red means run.</li>
                <li>Wardrobes hide you — unless she watched you climb in.</li>
                <li>Listen for her humming. If you can hear it, you know where she is.</li>
                <li>Keys move every attempt. Batteries are scarce. Each night is worse.</li>
              </ul>
            </div>
            <nav class="row">${btn('back', 'Back')}</nav>
          </div>`;
      case 'settings': {
        const s = this.host.settings();
        const q = (id: Quality, label: string): string =>
          `<button type="button" class="${s.quality === id ? 'sel' : ''}" data-act="quality" data-arg="${id}">${label}</button>`;
        return `
          <div class="panel">
            <h2>Settings</h2>
            <div class="settings">
              <label>Mouse sensitivity
                <input type="range" name="sensitivity" min="0.3" max="2.5" step="0.1" value="${s.sensitivity}">
                <output>${s.sensitivity.toFixed(1)}×</output>
              </label>
              <label>Volume
                <input type="range" name="volume" min="0" max="1" step="0.05" value="${s.volume}">
                <output>${Math.round(s.volume * 100)}%</output>
              </label>
              <div class="field">Graphics
                <div class="seg">${q('low', 'Low')}${q('medium', 'Medium')}${q('high', 'High')}</div>
              </div>
            </div>
            <nav class="row">${btn('back', 'Done', 'primary')}</nav>
          </div>`;
      }
      case 'pause':
        return `
          <div class="panel">
            <p class="kicker">Night ${level.id} — ${esc(level.name)}</p>
            <h2>Paused</h2>
            <nav>
              ${btn('resume', 'Resume', 'primary')}
              ${btn('restart', 'Restart Night')}
              ${btn('howto', 'How to Play')}
              ${btn('settings', 'Settings')}
              ${btn('quit', 'Quit to Menu')}
            </nav>
          </div>`;
      case 'intro':
        return `
          <div class="card" data-act="lock">
            <p class="kicker">Night ${level.id} of ${LEVELS.length}</p>
            <h2>${esc(level.name)}</h2>
            <p class="tagline">${esc(level.tagline)}</p>
            <p class="hint">${esc(level.hint)}</p>
            <p class="click">Click to begin</p>
          </div>`;
      case 'caught':
        return `
          <div class="card blood" data-act="lock">
            <h2>She found you</h2>
            <p class="tagline">You wake where you started. Your keys are still in your pocket.</p>
            <p class="hint">${d.livesLeft === 1 ? 'This is your last chance.' : `${d.livesLeft} chances left.`}</p>
            <p class="click">Click to try again</p>
          </div>`;
      case 'gameover':
        return `
          <div class="panel center blood">
            <p class="kicker">Night ${level.id} — ${esc(level.name)}</p>
            <h2>The cellar keeps you</h2>
            <p class="tagline">Nobody heard a thing.</p>
            <nav>
              ${btn('restart', 'Try the Night Again', 'primary')}
              ${btn('quit', 'Quit to Menu')}
            </nav>
          </div>`;
      case 'complete':
      case 'victory': {
        const won = screen === 'victory';
        const stats = `
          <dl class="stats">
            <dt>Time</dt><dd>${fmtTime(d.time ?? 0)}${d.newBest ? ' <em>new best</em>' : ''}</dd>
            <dt>Best</dt><dd>${fmtTime(d.best ?? d.time ?? 0)}</dd>
            <dt>Times caught</dt><dd>${d.catches ?? 0}</dd>
          </dl>`;
        return won
          ? `
          <div class="panel center dawn">
            <p class="kicker">Night ${level.id} — ${esc(level.name)}</p>
            <h2>You escaped</h2>
            <p class="tagline">Five nights. The door closes behind you, and something on the other side begins to hum.</p>
            ${stats}
            <nav>
              ${btn('quit', 'Main Menu', 'primary')}
            </nav>
          </div>`
          : `
          <div class="panel center dawn">
            <p class="kicker">Night ${level.id} — ${esc(level.name)}</p>
            <h2>You made it out</h2>
            <p class="tagline">For tonight.</p>
            ${stats}
            <nav>
              ${btn('next', `Night ${level.id + 1} — ${esc(LEVELS[level.id]?.name ?? '')}`, 'primary')}
              ${btn('restart', 'Replay This Night')}
              ${btn('quit', 'Main Menu')}
            </nav>
          </div>`;
      }
    }
  }
}
