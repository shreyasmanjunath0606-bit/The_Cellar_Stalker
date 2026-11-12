import { DIFFICULTIES, DIFFICULTY_ORDER, Difficulty, NIGHT_COUNT, levelFor, nightName } from '../core/Levels';
import { cleanName } from '../core/Save';
import type { Progress, Quality, Settings } from '../core/Save';
import { fmtTime } from './HUD';

export type Screen =
  | 'main' | 'nights' | 'howto' | 'settings'
  | 'pause' | 'intro' | 'gameover' | 'complete' | 'victory'
  | 'mp' | 'connecting' | 'lobby' | 'escaped';

export type MenuAction =
  | 'continue' | 'new' | 'play' | 'resume' | 'lock' | 'restart' | 'next' | 'quit'
  | 'host' | 'join' | 'start' | 'lobbyNight' | 'lobbyDiff' | 'leave' | 'toLobby';

/** The co-op room as the menu shows it. */
export interface LobbyView {
  code: string;
  hosting: boolean;
  night: number;
  diff: Difficulty;
  max: number;
  players: { name: string; color: string; me: boolean; host: boolean }[];
}

export interface MenuHost {
  progress(): Progress;
  settings(): Settings;
  lobby(): LobbyView | null;
  /** Called on every button press, before the action runs (starts audio, plays the tick). */
  touched(): void;
  act(action: MenuAction, arg?: string): void;
  applySettings(s: Settings): void;
}

/** What the result / status screens need to know. */
export interface ScreenData {
  night?: number;
  diff?: Difficulty;
  time?: number;
  best?: number;
  newBest?: boolean;
  catches?: number;
  /** Which way out was used. */
  route?: string;
  /** Co-op game. */
  mp?: boolean;
  hosting?: boolean;
  /** Players still inside (escaped screen). */
  waiting?: number;
  seconds?: number;
  error?: string;
  text?: string;
}

const VERSION = 'v2.0';
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const btn = (act: string, label: string, cls = '', arg = ''): string =>
  `<button type="button" class="${cls}" data-act="${act}"${arg ? ` data-arg="${arg}"` : ''}>${label}</button>`;

/** Every full-screen menu: title, night select, co-op lobby, settings, pause and the result cards. */
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
    this.root.addEventListener('keydown', (e) => {
      // typing a name or code must not reach the game, and Enter submits the form
      if ((e.target as HTMLElement).tagName !== 'INPUT') return;
      e.stopPropagation();
      if (e.code === 'Enter') this.root.querySelector<HTMLElement>('button.primary')?.click();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.screen && ['nights', 'howto', 'settings', 'mp'].includes(this.screen)) {
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
    const focus = this.root.querySelector<HTMLElement>('input[data-focus]') ?? this.root.querySelector<HTMLElement>('button.primary');
    focus?.focus({ preventScroll: true });
  }

  /** Redraws the current screen (the lobby list changed, a countdown ticked). */
  refresh(data: ScreenData = this.data): void {
    if (this.screen) this.show(this.screen, data);
  }

  hide(): void {
    this.screen = null;
    this.root.className = '';
    this.root.innerHTML = '';
  }

  private field(name: string): string {
    return this.root.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ?? '';
  }

  private saveName(): string {
    const name = cleanName(this.field('name'));
    this.host.applySettings({ ...this.host.settings(), name });
    return name;
  }

  private run(act: string, arg?: string): void {
    switch (act) {
      case 'nights':
      case 'howto':
      case 'settings':
      case 'mp':
        this.parent = this.screen === 'pause' ? 'pause' : 'main';
        this.show(act, act === 'mp' ? {} : this.data);
        break;
      case 'back':
        this.show(this.parent, this.data);
        break;
      case 'quality': {
        this.host.applySettings({ ...this.host.settings(), quality: arg as Quality, autoQuality: false });
        this.show('settings', this.data);
        break;
      }
      case 'difficulty':
        this.host.applySettings({ ...this.host.settings(), difficulty: arg as Difficulty });
        this.show('nights', this.data);
        break;
      case 'host':
        this.host.act('host', this.saveName());
        break;
      case 'join': {
        const code = this.field('code').toUpperCase().replace(/[^A-Z]/g, '');
        if (code.length !== 5) return this.show('mp', { error: 'Enter the 5-letter room code your host gave you.' });
        this.saveName();
        this.host.act('join', code);
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
    else if (el.name === 'autoQuality') s.autoQuality = el.checked;
    else if (el.name === 'invertY') s.invertY = el.checked;
    else return;
    this.host.applySettings(s);
    const out = el.parentElement?.querySelector('output');
    if (out) out.textContent = el.name === 'volume' ? `${Math.round(s.volume * 100)}%` : `${s.sensitivity.toFixed(1)}×`;
  }

  private diffSeg(act: string, current: Difficulty, enabled = true): string {
    return `<div class="seg">${DIFFICULTY_ORDER.map(
      (d) =>
        `<button type="button" class="${d === current ? 'sel' : ''}" data-act="${act}" data-arg="${d}" ${enabled ? '' : 'disabled'}>${DIFFICULTIES[d].label}</button>`,
    ).join('')}</div><p class="blurb">${esc(DIFFICULTIES[current].blurb)}</p>`;
  }

  private render(screen: Screen, d: ScreenData): string {
    const night = d.night ?? 1;
    const title = `Night ${night} — ${esc(nightName(night))}`;
    const diffLabel = DIFFICULTIES[d.diff ?? this.host.settings().difficulty].label;
    switch (screen) {
      case 'main': {
        const p = this.host.progress();
        const cont = p.unlocked > 1
          ? btn('continue', `Continue <em>Night ${p.unlocked} — ${esc(nightName(p.unlocked))} · ${diffLabel}</em>`, 'primary')
          : '';
        return `
          <div class="panel main">
            <p class="kicker">A stealth horror for one to five players</p>
            <h1>THE CELLAR<br><span>STALKER</span></h1>
            <nav>
              ${cont}
              ${btn('nights', p.unlocked > 1 ? 'Play Alone' : 'Play Alone', p.unlocked > 1 ? '' : 'primary')}
              ${btn('mp', 'Play Together <em>2–5 players, one room code</em>')}
              ${btn('howto', 'How to Play')}
              ${btn('settings', 'Settings')}
            </nav>
            ${p.finished ? '<p class="note">You have survived all five nights.</p>' : ''}
          </div>
          <footer>${VERSION} · Best played with headphones, in the dark.</footer>`;
      }
      case 'nights': {
        const p = this.host.progress();
        const diff = this.host.settings().difficulty;
        const cards = Array.from({ length: NIGHT_COUNT }, (_, i) => {
          const id = i + 1;
          const l = levelFor(id, diff);
          const open = id <= p.unlocked;
          const best = p.best[`${id}-${diff}`];
          return `
            <button type="button" class="night-card" data-act="play" data-arg="${id}" ${open ? '' : 'disabled'}>
              <small>NIGHT ${id}</small>
              <strong>${open ? esc(l.name) : '— locked —'}</strong>
              <span>${open ? `${l.stalkers > 1 ? 'two of them · ' : ''}${l.lives} chances · ${l.darts} darts` : 'Survive the night before'}</span>
              <span class="best">${best ? `Best ${fmtTime(best)}` : open ? 'Not yet escaped' : ''}</span>
            </button>`;
        }).join('');
        return `
          <div class="panel wide">
            <h2>Play Alone</h2>
            <p class="field-label">Difficulty</p>
            ${this.diffSeg('difficulty', diff)}
            <div class="nights">${cards}</div>
            <nav class="row">${btn('back', 'Back')}</nav>
          </div>`;
      }
      case 'mp': {
        const name = esc(this.host.settings().name);
        return `
          <div class="panel">
            <h2>Play Together</h2>
            <p class="error">${esc(d.error ?? '')}</p>
            <div class="form">
              <label>Your name
                <input type="text" name="name" maxlength="14" value="${name}" placeholder="Player" data-focus autocomplete="off" spellcheck="false">
              </label>
              <label>Room code (to join a friend)
                <input type="text" name="code" maxlength="5" placeholder="ABCDE" autocomplete="off" spellcheck="false">
              </label>
            </div>
            <nav>
              ${btn('join', 'Join Game', 'primary')}
              ${btn('host', 'Host a New Game <em>you get a code to share</em>')}
              ${btn('back', 'Back')}
            </nav>
          </div>`;
      }
      case 'connecting':
        return `
          <div class="panel center">
            <h2>Connecting…</h2>
            <p class="hint">${esc(d.text ?? '')}</p>
            <nav>${btn('leave', 'Cancel')}</nav>
          </div>`;
      case 'lobby': {
        const l = this.host.lobby();
        if (!l) return '';
        const rows = Array.from({ length: l.max }, (_, i) => {
          const p = l.players[i];
          return p
            ? `<div><i style="background:${p.color}"></i>${esc(p.name)}<em>${p.host ? 'host' : ''}${p.me ? ' (you)' : ''}</em></div>`
            : '<div class="empty">— open —</div>';
        }).join('');
        const p = this.host.progress();
        const nights = Array.from({ length: NIGHT_COUNT }, (_, i) => {
          const id = i + 1;
          const open = l.hosting && id <= p.unlocked;
          return `<button type="button" class="${id === l.night ? 'sel' : ''}" data-act="lobbyNight" data-arg="${id}" ${open ? '' : 'disabled'}>${id}</button>`;
        }).join('');
        return `
          <div class="panel wide">
            <p class="kicker">Room code — share it with your friends</p>
            <p class="lobby-code">${esc(l.code)}</p>
            <div class="cols">
              <div>
                <p class="field-label">Players ${l.players.length} / ${l.max}</p>
                <div class="roster">${rows}</div>
              </div>
              <div>
                <p class="field-label">Night — ${esc(nightName(l.night))}</p>
                <div class="seg">${nights}</div>
                <p class="field-label">Difficulty</p>
                ${this.diffSeg('lobbyDiff', l.diff, l.hosting)}
                <nav>
                  ${l.hosting ? btn('start', 'Start the Night', 'primary') : '<p class="hint">Waiting for the host to start…</p>'}
                  ${btn('leave', 'Leave Room')}
                </nav>
              </div>
            </div>
          </div>`;
      }
      case 'howto':
        return `
          <div class="panel wide">
            <h2>How to Play</h2>
            <div class="cols">
              <dl class="controls">
                <dt>W A S D</dt><dd>Move</dd>
                <dt>Mouse</dt><dd>Look around</dd>
                <dt>Arrow keys</dt><dd>Also turn the view (handy on a laptop touchpad)</dd>
                <dt>Shift</dt><dd>Sprint — loud, and it drains stamina</dd>
                <dt>C</dt><dd>Crouch — slow, quiet, harder to see</dd>
                <dt>F</dt><dd>Flashlight — she sees the light from further away</dd>
                <dt>E</dt><dd>Take · hide · use a tool · set off a distraction</dd>
                <dt>Click</dt><dd>Fire a sleeping dart at her · shove an object</dd>
                <dt>Esc</dt><dd>Pause</dd>
              </dl>
              <ul class="tips">
                <li><b>Three ways out.</b> The front door (hammer, bolt cutters, every key), the car in the garage (battery, fuel, winch crank, car key) or the balcony (balcony key, two ladder sections, rope). Any one will do.</li>
                <li>The checklist at the bottom right shows what each way out still needs. Item glows match: <b>gold</b> front door, <b>orange</b> garage, <b>blue</b> balcony.</li>
                <li>Find the <b>crossbow</b> and a <b>dart</b>, then click on her: she sleeps for two minutes.</li>
                <li>Radios, alarm clocks, music boxes and the piano draw her away. So does anything you knock over.</li>
                <li>Hide in wardrobes or under beds — unless she watched you get in.</li>
                <li>She hunts by sound. Watch the <b>NOISE</b> bar; pale patches of floor creak.</li>
                <li>Together, everything found is shared, and so are your chances.</li>
              </ul>
            </div>
            <p class="hint">Touchpad not turning while you walk? Windows blocks the touchpad while keys are held. Use a mouse, turn with the arrow keys, or set Touchpad sensitivity to “Most sensitive” in Windows settings.</p>
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
                <input type="range" name="sensitivity" min="0.2" max="4" step="0.1" value="${s.sensitivity}">
                <output>${s.sensitivity.toFixed(1)}×</output>
              </label>
              <label class="check"><input type="checkbox" name="invertY" ${s.invertY ? 'checked' : ''}>Invert vertical look</label>
              <label>Volume
                <input type="range" name="volume" min="0" max="1" step="0.05" value="${s.volume}">
                <output>${Math.round(s.volume * 100)}%</output>
              </label>
              <div class="field">Graphics
                <div class="seg">${q('low', 'Low')}${q('medium', 'Medium')}${q('high', 'High')}</div>
              </div>
              <label class="check"><input type="checkbox" name="autoQuality" ${s.autoQuality ? 'checked' : ''}>Lower graphics automatically if the game runs slowly</label>
            </div>
            <nav class="row">${btn('back', 'Done', 'primary')}</nav>
          </div>`;
      }
      case 'pause':
        return `
          <div class="panel">
            <p class="kicker">${title} · ${diffLabel}</p>
            <h2>${d.mp ? 'Menu' : 'Paused'}</h2>
            ${d.mp ? '<p class="hint">The night goes on while this is open.</p>' : ''}
            <nav>
              ${btn('resume', 'Resume', 'primary')}
              ${d.mp ? '' : btn('restart', 'Restart Night')}
              ${btn('howto', 'How to Play')}
              ${btn('settings', 'Settings')}
              ${d.mp ? btn('leave', 'Leave Game') : btn('quit', 'Quit to Menu')}
            </nav>
          </div>`;
      case 'intro': {
        const l = levelFor(night, d.diff ?? 'easy');
        return `
          <div class="card" data-act="lock">
            <p class="kicker">Night ${night} of ${NIGHT_COUNT} · ${diffLabel}</p>
            <h2>${esc(l.name)}</h2>
            <p class="tagline">${esc(l.tagline)}</p>
            <p class="hint">${esc(l.hint)}</p>
            <p class="click">Click to begin</p>
          </div>`;
      }
      case 'escaped':
        return `
          <div class="panel center dawn">
            <p class="kicker">${title}</p>
            <h2>You are out</h2>
            <p class="tagline">${d.waiting ? `${d.waiting} still inside.` : 'Everyone is out.'}</p>
            <p class="hint">${d.seconds ? `Leaving without them in ${d.seconds} s.` : ''}</p>
          </div>`;
      case 'gameover':
        return `
          <div class="panel center blood">
            <p class="kicker">${title} · ${diffLabel}</p>
            <h2>The house keeps you</h2>
            <p class="tagline">Nobody heard a thing.</p>
            ${this.resultNav(d, false)}
          </div>`;
      case 'complete':
      case 'victory': {
        const won = screen === 'victory';
        const stats = `
          <dl class="stats">
            <dt>Way out</dt><dd>${esc(d.route ?? '')}</dd>
            <dt>Time</dt><dd>${fmtTime(d.time ?? 0)}${d.newBest ? ' <em>new best</em>' : ''}</dd>
            ${d.mp ? '' : `<dt>Best</dt><dd>${fmtTime(d.best ?? d.time ?? 0)}</dd>`}
            <dt>Times caught</dt><dd>${d.catches ?? 0}</dd>
          </dl>`;
        return `
          <div class="panel center dawn">
            <p class="kicker">${title} · ${diffLabel}</p>
            <h2>${won ? 'You escaped' : 'You made it out'}</h2>
            <p class="tagline">${won ? 'Five nights. The door closes behind you, and something inside begins to hum.' : 'For tonight.'}</p>
            ${stats}
            ${this.resultNav(d, true)}
          </div>`;
      }
    }
  }

  private resultNav(d: ScreenData, won: boolean): string {
    const night = d.night ?? 1;
    const next = won && night < NIGHT_COUNT ? btn('next', `Night ${night + 1} — ${esc(nightName(night + 1))}`, 'primary') : '';
    if (d.mp && !d.hosting) {
      return `<p class="hint">Waiting for the host…</p><nav>${btn('leave', 'Leave Game')}</nav>`;
    }
    if (d.mp) {
      return `<nav>${next}${btn('restart', won ? 'Replay This Night' : 'Try the Night Again', next ? '' : 'primary')}${btn('toLobby', 'Back to the Room')}${btn('leave', 'Leave Game')}</nav>`;
    }
    return `<nav>${next}${btn('restart', won ? 'Replay This Night' : 'Try the Night Again', next ? '' : 'primary')}${btn('quit', 'Main Menu')}</nav>`;
  }
}
