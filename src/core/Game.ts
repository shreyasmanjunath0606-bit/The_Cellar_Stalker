import * as THREE from 'three';
import { GameTime } from './Time';
import { GameState, StateManager } from './StateManager';
import { Input } from './Input';
import { Physics, RAPIER } from './Physics';
import { DIFFICULTIES, Difficulty, LevelConfig, NIGHT_COUNT, SLEEP_SECONDS, levelFor } from './Levels';
import { Progress, Quality, Save, Settings } from './Save';
import { Rng, randomSeed } from './Rng';
import { GameRenderer, SHADOW_SIZE } from '../rendering/GameRenderer';
import { createMaterials, Materials } from '../rendering/Materials';
import { TensionEffects } from '../rendering/TensionEffects';
import { Effects } from '../rendering/Effects';
import { AudioManager } from '../audio/AudioManager';
import { SoundBus } from '../ai/SoundBus';
import { Stalker, StalkerState, Target } from '../ai/Stalker';
import { WaypointGraph } from '../ai/Waypoints';
import { House } from '../environment/House';
import { STAIRS, WAYPOINTS } from '../environment/Layout';
import { PropManager } from '../environment/Props';
import { Floorboards } from '../environment/Floorboards';
import { Items } from '../environment/Items';
import { Objectives, ROUTE_NAMES, RouteId } from '../environment/Objectives';
import { Distractions } from '../environment/Distractions';
import { PlayerController } from '../player/PlayerController';
import { Flashlight } from '../player/Flashlight';
import { Inventory, ITEM_NAMES } from '../player/Inventory';
import { Interaction } from '../player/Interaction';
import { Avatar, PLAYER_COLORS, PlayerState } from '../player/Avatar';
import { GameEvent, MAX_PLAYERS, Msg, Net, PlayerInfo } from '../net/Net';
import { HUD } from '../ui/HUD';
import { LobbyView, Menu, MenuAction } from '../ui/Menu';
import { SoundVisualizer } from '../ui/SoundVisualizer';
import { JumpscareOverlay } from '../ui/JumpscareOverlay';

/** Noise radius (m) that fills the HUD noise bar. */
const NOISE_BAR_MAX = 20;
const BATTERY_CHARGE = 50;
const DART_RANGE = 14;
/** Network ticks per second. */
const NET_RATE = 15;
/** Seconds the rest of the team has to get out once the first player has escaped. */
const ESCAPE_WINDOW = 90;
/** Seconds a caught player is out before waking up in the bedroom again. */
const DOWN_TIME = 4;
const SOLO: PlayerInfo = { id: 'host', name: 'You', slot: 0 };
const DEV = import.meta.env.DEV;
const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** Everything that is rebuilt from scratch for each night. */
interface World {
  config: LevelConfig;
  night: number;
  diff: Difficulty;
  roster: PlayerInfo[];
  root: THREE.Group;
  physics: Physics;
  bus: SoundBus;
  house: House;
  props: PropManager;
  floorboards: Floorboards;
  items: Items;
  objectives: Objectives;
  distractions: Distractions;
  player: PlayerController;
  flashlight: Flashlight;
  inventory: Inventory;
  interaction: Interaction;
  graph: WaypointGraph;
  stalkers: Stalker[];
  prevStates: StalkerState[];
  soundViz: SoundVisualizer;
  /** The other players, by id. */
  avatars: Map<string, Avatar>;
  /** Everyone she can hunt; `me` is the local player's entry. */
  targets: Target[];
  me: Target;
  spawn: THREE.Vector3;
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) if (!mat.userData.shared) mat.dispose();
    (o as THREE.Light).dispose?.();
  });
}

export class Game {
  readonly time = new GameTime();
  readonly state = new StateManager();

  private readonly rendering: GameRenderer;
  private readonly input: Input;
  private readonly audio = new AudioManager();
  private readonly mats: Materials;
  private readonly fx: Effects;
  private readonly tension: TensionEffects;
  private readonly jumpscare = new JumpscareOverlay();
  private readonly hud = new HUD();
  private readonly menu: Menu;
  private readonly scratch = new THREE.Vector3();

  private settings: Settings = Save.loadSettings();
  private progress: Progress = Save.loadProgress(NIGHT_COUNT);
  private w!: World;
  /** The co-op session, if any. */
  private net: Net | null = null;

  private lives = 0;
  private catches = 0;
  private levelTime = 0;
  private noisePulse = 0;
  private fear = 0;
  private pulse = 0;
  private fade = 0;
  private lightWasOn = true;
  private warnedBattery = false;
  private begun = false;
  /** Seconds until the local player wakes up after being caught. */
  private downTimer = 0;
  private escaped = false;
  private readonly escapedIds = new Set<string>();
  private lastRoute: RouteId = 'door';
  /** Seconds left for the others to get out, or -1. */
  private escapeIn = -1;
  private netTimer = 0;
  private teamTimer = 0;
  /** Host: seconds a just-caught player cannot be targeted. */
  private readonly immune = new Map<string, number>();
  private readonly wasHidden = new Map<string, boolean>();
  // frame-rate watch for automatic quality
  private fpsFrames = 0;
  private fpsSince = 0;
  private lastTick = 0;
  private lastFrame = 0;

  private constructor(container: HTMLElement) {
    this.rendering = new GameRenderer(container, this.settings.quality);
    this.input = new Input(this.rendering.canvas);
    this.mats = createMaterials();
    this.fx = new Effects(this.rendering.scene);
    this.tension = new TensionEffects(this.rendering.post, this.rendering.camera);
    this.audio.setVolume(this.settings.volume);

    this.menu = new Menu({
      progress: () => this.progress,
      settings: () => this.settings,
      lobby: () => this.lobbyView(),
      touched: () => {
        this.audio.start();
        this.audio.playUi();
      },
      act: (action, arg) => this.act(action, arg),
      applySettings: (s) => this.applySettings(s),
    });
    this.input.onLockChange = (locked) => this.onLockChange(locked);

    this.loadLevel(1, this.settings.difficulty, randomSeed(), [SOLO]);
    this.menu.show('main');

    // A hidden tab gets no animation frames. In co-op the night must go on regardless
    // (above all for the host, who runs her), so a worker keeps time while we are hidden.
    try {
      const src = URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),33)'], { type: 'text/javascript' }));
      new Worker(src).onmessage = () => {
        // also covers a window that is visible in name but starved of frames (minimised, fully covered)
        if (this.net && performance.now() - this.lastFrame > 250) this.step(performance.now(), false);
      };
    } catch {
      /* no workers: a hidden host simply pauses the night */
    }
  }

  static async create(container: HTMLElement): Promise<Game> {
    await Physics.init();
    return new Game(container);
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  // ---- roles --------------------------------------------------------------

  /** True on the machine that runs her and decides what happens: solo, or the co-op host. */
  private get authority(): boolean {
    return !this.net || this.net.hosting;
  }

  private get myId(): string {
    return this.net ? this.net.id : SOLO.id;
  }

  private nameOf(id: string): string {
    return this.w.roster.find((p) => p.id === id)?.name ?? 'Someone';
  }

  // ---- menu flow ----------------------------------------------------------

  private act(action: MenuAction, arg?: string): void {
    const night = this.w.night;
    switch (action) {
      case 'continue':
        this.startSolo(this.progress.unlocked);
        break;
      case 'new':
      case 'play':
        this.startSolo(Number(arg) || 1);
        break;
      case 'restart':
        if (this.net) this.hostStart(night);
        else this.startSolo(night);
        break;
      case 'next':
        if (this.net) this.hostStart(night + 1);
        else this.startSolo(night + 1);
        break;
      case 'resume':
      case 'lock':
        this.input.requestLock();
        break;
      case 'quit':
        this.toMenu();
        break;
      case 'host':
        void this.openRoom(null);
        break;
      case 'join':
        void this.openRoom(arg ?? '');
        break;
      case 'start':
        if (this.net?.hosting) this.hostStart(this.net.night);
        break;
      case 'lobbyNight':
        if (this.net?.hosting) {
          this.net.night = THREE.MathUtils.clamp(Number(arg) || 1, 1, this.progress.unlocked);
          this.net.sendRoster();
        }
        break;
      case 'lobbyDiff':
        if (this.net?.hosting) {
          this.net.diff = arg as Difficulty;
          this.net.sendRoster();
        }
        break;
      case 'toLobby':
        if (this.net?.hosting) {
          this.net.started = false;
          this.net.send({ t: 'lobby' });
          this.toLobby();
        }
        break;
      case 'leave':
        this.leaveRoom();
        this.toMenu();
        break;
    }
  }

  private startSolo(id: number): void {
    const n = THREE.MathUtils.clamp(Math.floor(id) || 1, 1, Math.min(NIGHT_COUNT, this.progress.unlocked));
    this.beginLevel(n, this.settings.difficulty, randomSeed(), [SOLO]);
  }

  private hostStart(id: number): void {
    const net = this.net;
    if (!net?.hosting) return;
    const night = THREE.MathUtils.clamp(Math.floor(id) || 1, 1, NIGHT_COUNT);
    net.night = night;
    net.started = true;
    const start: Msg = { t: 'start', night, diff: net.diff, seed: randomSeed(), players: net.players };
    net.send(start);
    this.beginLevel(night, net.diff, start.seed, net.players);
  }

  private beginLevel(night: number, diff: Difficulty, seed: number, roster: PlayerInfo[]): void {
    this.loadLevel(night, diff, seed, roster);
    this.audio.setDucked(false);
    this.hud.setVisible(false);
    // In co-op the night starts for everyone at once; alone it waits for the first click.
    this.state.set(this.net ? GameState.Playing : GameState.Intro);
    this.menu.show('intro', { night, diff });
    this.input.requestLock();
  }

  private toMenu(): void {
    if (document.pointerLockElement) document.exitPointerLock();
    this.state.set(GameState.Menu);
    this.loadLevel(this.w.night, this.settings.difficulty, randomSeed(), [SOLO]);
    this.audio.setDucked(false);
    this.hud.setVisible(false);
    this.hud.clearMessages();
    this.menu.show('main');
  }

  private toLobby(): void {
    if (document.pointerLockElement) document.exitPointerLock();
    this.state.set(GameState.Menu);
    this.resetMood();
    this.hud.setVisible(false);
    this.hud.clearMessages();
    this.audio.setDucked(false);
    this.menu.show('lobby');
  }

  private onLockChange(locked: boolean): void {
    if (locked) {
      if (!this.state.is(GameState.Intro, GameState.Paused, GameState.Playing) || this.escaped) return;
      this.state.set(GameState.Playing);
      if (!this.begun) this.beginNight();
      this.menu.hide();
      this.hud.setVisible(true);
      this.audio.start();
      this.audio.setDucked(false);
    } else if (this.state.is(GameState.Playing) && !this.escaped) {
      if (!this.net) {
        this.state.set(GameState.Paused);
        this.audio.setDucked(true);
      }
      this.menu.show(this.begun ? 'pause' : 'intro', { night: this.w.night, diff: this.w.diff, mp: !!this.net });
    }
  }

  private beginNight(): void {
    const c = this.w.config;
    this.begun = true;
    this.fade = 1;
    this.hud.showBanner(`NIGHT ${c.id} · ${DIFFICULTIES[this.w.diff].label.toUpperCase()}`, c.name, c.hint);
  }

  private applySettings(s: Settings): void {
    const qualityChanged = s.quality !== this.settings.quality;
    this.settings = s;
    Save.saveSettings(s);
    this.audio.setVolume(s.volume);
    this.w.player.sensitivity = s.sensitivity;
    this.w.player.invertY = s.invertY;
    if (qualityChanged) this.setQuality(s.quality);
  }

  private setQuality(q: Quality): void {
    this.rendering.setQuality(q);
    this.w.flashlight.setShadowSize(SHADOW_SIZE[q]);
    this.fpsFrames = 0;
    this.fpsSince = 0;
  }

  // ---- co-op room ---------------------------------------------------------

  private lobbyView(): LobbyView | null {
    const net = this.net;
    if (!net) return null;
    return {
      code: net.code,
      hosting: net.hosting,
      night: net.night,
      diff: net.diff,
      max: MAX_PLAYERS,
      players: net.players.map((p) => ({
        name: p.name, color: css(PLAYER_COLORS[p.slot % PLAYER_COLORS.length]), me: p.id === net.id, host: p.slot === 0,
      })),
    };
  }

  /** Hosts a new room (`code` null) or joins an existing one. */
  private async openRoom(code: string | null): Promise<void> {
    this.leaveRoom();
    this.menu.show('connecting', { text: code ? `Looking for room ${code}…` : 'Opening a room…' });
    const name = this.settings.name;
    try {
      const net = code === null ? await Net.host(name) : await Net.join(code, name);
      if (this.menu.current !== 'connecting') return net.close(); // cancelled while connecting
      this.net = net;
      net.diff = this.settings.difficulty;
      net.night = 1;
      net.onMessage = (from, msg) => this.onNet(from, msg);
      net.onRoster = () => this.onRoster();
      net.onPlayerLeft = (id) => this.onPlayerLeft(id);
      net.onClosed = (why) => {
        this.leaveRoom();
        this.toMenu();
        this.menu.show('mp', { error: why });
      };
      if (net.hosting) this.menu.show('lobby');
      // a client shows the lobby once the host has sent the roster
    } catch (err) {
      this.menu.show('mp', { error: (err as Error).message || 'Could not connect.' });
    }
  }

  private leaveRoom(): void {
    this.net?.close();
    this.net = null;
  }

  private onRoster(): void {
    const net = this.net;
    if (!net) return;
    if (this.menu.current === 'lobby' || this.menu.current === 'connecting') this.menu.show('lobby');
    // drop the figures of anyone who has left mid-night
    for (const [id, a] of this.w.avatars) {
      if (!net.players.some((p) => p.id === id) && a.state) {
        a.drop();
        this.hud.toast(`${this.nameOf(id)} left the game`, true);
      }
    }
  }

  private onPlayerLeft(id: string): void {
    this.immune.delete(id);
    this.escapedIds.delete(id);
    if (this.state.is(GameState.Playing)) this.checkAllOut();
  }

  private onNet(from: string, msg: Msg): void {
    const net = this.net;
    if (!net) return;
    if (net.hosting) {
      switch (msg.t) {
        case 'me':
          this.w.avatars.get(from)?.apply(msg.s);
          break;
        case 'req':
          if (this.state.is(GameState.Playing)) {
            const ev = { ...msg.ev, by: from } as GameEvent;
            if (ev.k === 'escaped') ev.id = from;
            this.request(ev, true);
          }
          break;
        case 'noise':
          if (this.state.is(GameState.Playing)) {
            this.w.bus.emit(this.scratch.set(msg.x, msg.y, msg.z), Math.min(30, msg.r), 'prop');
          }
          break;
      }
      return;
    }
    switch (msg.t) {
      case 'start':
        net.started = true;
        net.players = msg.players;
        this.beginLevel(msg.night, msg.diff, msg.seed, msg.players);
        break;
      case 'world':
        if (!this.state.is(GameState.Playing)) break;
        for (const [id, s] of Object.entries(msg.p)) if (id !== net.id) this.w.avatars.get(id)?.apply(s);
        msg.s.forEach((s, i) => this.w.stalkers[i]?.applySnapshot(s));
        this.levelTime = msg.time;
        this.escapeIn = msg.escapeIn;
        break;
      case 'ev':
        if (this.state.is(GameState.Playing)) this.apply(msg.ev);
        break;
      case 'toast':
        this.hud.toast(msg.text, msg.warn);
        break;
      case 'lobby':
        net.started = false;
        this.toLobby();
        break;
    }
  }

  // ---- shared-world events ------------------------------------------------

  /**
   * Asks for something to happen in the shared world. Alone it just happens; in co-op the host
   * checks it and tells everyone, so two players can never both take the same key.
   */
  private request(ev: GameEvent, fromClient = false): void {
    const net = this.net;
    if (net && !net.hosting) return net.send({ t: 'req', ev });
    if (fromClient && (ev.k === 'caught' || ev.k === 'over' || ev.k === 'quiet' || ev.k === 'wake' || ev.k === 'instinct')) return;
    if (!this.valid(ev)) return;
    net?.send({ t: 'ev', ev });
    this.apply(ev);
  }

  private valid(ev: GameEvent): boolean {
    const { items, objectives, distractions, inventory, stalkers } = this.w;
    switch (ev.k) {
      case 'pickup':
        return !!items.items[ev.item] && !items.items[ev.item].collected;
      case 'step': {
        const s = objectives.stations[ev.station];
        const n = s ? objectives.next(s) : null;
        return !!s && !!n && n.index === ev.step && !objectives.blocked(s) && inventory.has(n.step.needs, n.step.count);
      }
      case 'distract':
        return !!distractions.list[ev.id] && distractions.ready(distractions.list[ev.id]);
      case 'dart':
        return inventory.has('crossbow') && inventory.has('dart') && !!stalkers[ev.stalker] && !stalkers[ev.stalker].asleep;
      case 'escaped':
        return objectives.routeOpen(ev.route as RouteId) && !this.escapedIds.has(ev.id);
      default:
        return true;
    }
  }

  /** Makes an agreed event happen on this machine. Runs identically for every player. */
  private apply(ev: GameEvent): void {
    const { hud, audio, fx } = this;
    const { items, objectives, distractions, inventory, props, flashlight, stalkers, bus, player } = this.w;
    const mine = 'by' in ev && ev.by === this.myId;
    const who = 'by' in ev ? this.nameOf(ev.by) : '';
    const team = this.w.roster.length > 1;
    switch (ev.k) {
      case 'pickup': {
        const item = items.collect(ev.item);
        if (!item) break;
        fx.sparkle(item.mesh.position, item.type === 'battery' ? 0x70ff80 : 0xffc860);
        if (mine) audio.playPickup();
        if (item.type === 'battery') {
          if (mine) {
            flashlight.addBattery(BATTERY_CHARGE);
            this.warnedBattery = false;
            hud.toast(`BATTERY +${BATTERY_CHARGE}%`);
          }
          break;
        }
        inventory.add(item.type);
        const name = ITEM_NAMES[item.type];
        if (item.type === 'crossbow') hud.toast(`${team ? `${who} found the ` : ''}${name} — click on her to fire a dart`);
        else hud.toast(team ? `${who} found a ${name}` : `Found: ${name}`);
        this.refreshHud();
        break;
      }
      case 'step': {
        const s = objectives.stations[ev.station];
        const n = s ? objectives.next(s) : null;
        if (!s || !n || n.index !== ev.step) break;
        inventory.take(n.step.needs, n.step.count);
        objectives.complete(ev.station, ev.step);
        audio.playWork(n.step.sfx, s.pos);
        if (n.step.sfx === 'wood') fx.puff(s.pos, 8);
        // only the one doing the work reports the noise, so she hears it once
        if (mine) bus.emit(s.pos, n.step.noise, 'work');
        if (objectives.routeOpen(s.route)) {
          this.onRouteOpen(s.route);
        } else {
          hud.toast(team ? `${who}: ${n.step.label} done` : `${n.step.label} done`);
        }
        if (ev.station === 3 && this.authority) {
          this.w.graph.addLink(new THREE.Vector3(9.5, 3, 8.2), new THREE.Vector3(9.5, 3, 10));
        }
        this.refreshHud();
        break;
      }
      case 'distract':
        if (distractions.trigger(ev.id) && mine && distractions.list[ev.id].kind === 'alarm') {
          hud.toast('It will ring in 10 seconds — get clear');
        }
        break;
      case 'quiet':
        distractions.silence(ev.id);
        break;
      case 'shove': {
        const prop = props.get(ev.prop);
        if (prop && !mine) props.shove(prop, new THREE.Vector3(...ev.d), new THREE.Vector3(...ev.p));
        break;
      }
      case 'dart': {
        const s = stalkers[ev.stalker];
        if (!s) break;
        inventory.take('dart');
        if (mine) audio.playDart();
        audio.playThud(s.position);
        fx.puff(s.position, 10);
        if (this.authority) s.sleep(SLEEP_SECONDS);
        hud.toast(`${team ? `${who} put her` : 'She is'} to sleep — ${SLEEP_SECONDS / 60} minutes`);
        this.refreshHud();
        break;
      }
      case 'wake':
        hud.toast('She is awake again', true);
        break;
      case 'instinct':
        hud.toast('Something stirs… she is coming', true);
        break;
      case 'caught': {
        this.catches++;
        this.lives = ev.lives;
        hud.setLives(this.lives, this.w.config.lives);
        if (ev.id === this.myId) {
          // wake up back in the bedroom, shaken
          this.downTimer = DOWN_TIME;
          this.jumpscare.set(0);
          this.w.me.active = false;
          player.teleport(this.w.spawn);
          player.yaw = 0;
          player.pitch = 0;
          hud.setHidden(false);
          if (flashlight.battery > 0) flashlight.on = true;
          if (this.lives > 0) {
            hud.toast(this.lives === 1 ? 'She got you — this is the last chance' : `She got you — ${this.lives} chances left`, true);
          }
        } else if (this.lives > 0) {
          hud.toast(`She got ${this.nameOf(ev.id)} — ${this.lives} chance${this.lives === 1 ? '' : 's'} left`, true);
        }
        break;
      }
      case 'escaped': {
        this.escapedIds.add(ev.id);
        this.lastRoute = ev.route as RouteId;
        if (ev.id === this.myId) {
          this.escaped = true;
          this.w.me.active = false;
          if (team) {
            if (document.pointerLockElement) document.exitPointerLock();
            hud.setVisible(false);
            this.showEscaped();
          }
        } else {
          hud.toast(`${this.nameOf(ev.id)} got out`);
        }
        if (this.authority) {
          if (this.escapeIn < 0) this.escapeIn = ESCAPE_WINDOW;
          this.checkAllOut();
        }
        break;
      }
      case 'over':
        this.finish(ev.win, ev.time);
        break;
    }
  }

  private onRouteOpen(route: RouteId): void {
    const { hud, audio, fx } = this;
    const { objectives, bus } = this.w;
    const text: Record<RouteId, string> = {
      door: 'The front door is open — get out',
      car: 'The engine is running — get to the car',
      balcony: 'The ladder is ready — climb down from the balcony',
    };
    hud.toast(text[route]);
    if (route === 'door') {
      const pos = objectives.stations[0].pos;
      audio.playDoorOpen(pos);
      fx.doorDust(pos);
      if (this.authority) bus.emit(pos, 22, 'work');
    }
  }

  private showEscaped(): void {
    const inside = this.w.roster.filter((p) => !this.escapedIds.has(p.id) && this.present(p.id)).length;
    this.menu.show('escaped', { night: this.w.night, waiting: inside, seconds: Math.max(0, Math.ceil(this.escapeIn)) });
  }

  /** True while a player is still connected. */
  private present(id: string): boolean {
    return !this.net || this.net.players.some((p) => p.id === id);
  }

  /** Host: the night is won once everybody still connected is out. */
  private checkAllOut(): void {
    if (!this.authority || !this.state.is(GameState.Playing) || this.escapedIds.size === 0) return;
    const inside = this.w.roster.filter((p) => this.present(p.id) && !this.escapedIds.has(p.id));
    if (inside.length === 0) this.request({ k: 'over', win: true, time: this.levelTime });
  }

  private finish(win: boolean, time: number): void {
    if (!this.state.is(GameState.Playing, GameState.Paused)) return;
    const { night, diff } = this.w;
    const mp = !!this.net;
    if (document.pointerLockElement) document.exitPointerLock();
    this.resetMood();
    this.hud.setVisible(false);
    this.hud.clearMessages();
    if (!win) {
      this.state.set(GameState.GameOver);
      this.audio.setDucked(true);
      this.audio.playGameOver();
      this.menu.show('gameover', { night, diff, mp, hosting: this.net?.hosting });
      return;
    }
    const last = night === NIGHT_COUNT;
    const key = `${night}-${diff}`;
    const prev = this.progress.best[key];
    const newBest = !mp && (prev === undefined || time < prev);
    if (newBest) this.progress.best[key] = time;
    this.progress.unlocked = Math.max(this.progress.unlocked, Math.min(NIGHT_COUNT, night + 1));
    if (last) this.progress.finished = true;
    Save.saveProgress(this.progress);
    this.state.set(last ? GameState.Victory : GameState.LevelComplete);
    this.audio.playEscape();
    this.menu.show(last ? 'victory' : 'complete', {
      night, diff, time, best: this.progress.best[key], newBest: newBest && prev !== undefined,
      catches: this.catches, route: ROUTE_NAMES[this.lastRoute], mp, hosting: this.net?.hosting,
    });
  }

  private refreshHud(): void {
    const { objectives, inventory } = this.w;
    this.hud.setRoutes(objectives.summary().map((r) => ({ name: ROUTE_NAMES[r.route], open: r.open, steps: r.steps })));
    this.hud.setBag(inventory.list().map(([t, n]) => ({ name: ITEM_NAMES[t], count: n })));
  }

  // ---- level lifecycle ----------------------------------------------------

  private loadLevel(night: number, diff: Difficulty, seed: number, roster: PlayerInfo[]): void {
    if (this.w) this.unloadLevel();
    const config = levelFor(night, diff, roster.length);
    const { rendering, input, audio, mats, fx } = this;
    const myId = this.myId;
    const mySlot = roster.find((p) => p.id === myId)?.slot ?? 0;

    const physics = new Physics();
    const root = new THREE.Group();
    rendering.scene.add(root);
    rendering.setAtmosphere(config.fog, config.blackout ? 0.22 : 0.22 + 0.16 * config.lightScale);

    const bus = new SoundBus();
    const house = new House(physics, mats, config);
    const props = new PropManager(physics, mats, bus, audio, fx);
    const floorboards = new Floorboards(mats, bus, audio, config);
    const items = new Items(mats, config, new Rng(seed));
    const objectives = new Objectives(physics, mats, config);
    const distractions = new Distractions(mats, bus, audio);
    root.add(house.group, props.group, floorboards.group, items.group, objectives.group, distractions.group);
    house.onSpark = (pos) => {
      fx.sparks(pos);
      audio.playSpark(pos);
    };

    const spawn = house.spawns[mySlot % house.spawns.length];
    const player = new PlayerController(physics, rendering.camera, input, audio, bus, spawn);
    player.sensitivity = this.settings.sensitivity;
    player.invertY = this.settings.invertY;
    const flashlight = new Flashlight(root, mats.cookie, config.batteryDrain, SHADOW_SIZE[this.settings.quality]);
    const inventory = new Inventory();

    const me: Target = {
      id: myId, feet: player.feet, eye: player.eyePosition, hidden: false, exposed: false,
      crouching: false, lightOn: true, active: true,
    };
    const targets: Target[] = [me];
    const avatars = new Map<string, Avatar>();
    for (const p of roster) {
      if (p.id === myId) continue;
      const avatar = new Avatar(root, p.name, PLAYER_COLORS[p.slot % PLAYER_COLORS.length]);
      avatars.set(p.id, avatar);
      targets.push({
        id: p.id, feet: avatar.feet, eye: avatar.eye, hidden: false, exposed: false,
        crouching: false, lightOn: false, active: false,
      });
    }

    physics.step(1 / 60); // populates the query pipeline so the graph's raycasts see the walls
    const graph = new WaypointGraph(physics, WAYPOINTS, STAIRS);
    if (DEV) {
      const lost = graph.unreachable().filter((i) => graph.nodes[i].links.length > 0 || i !== WAYPOINTS.length - 1);
      if (lost.length) console.warn(`[night ${night}] unreachable waypoints:`, lost.map((i) => graph.nodes[i].pos.toArray()));
    }

    const authority = this.authority;
    const stalkers: Stalker[] = [];
    const startNodes: number[] = [];
    for (let i = 0; i < config.stalkers; i++) {
      // as far from the bedroom — and from each other — as the house allows
      const node = graph.farthestNode(spawn, ...startNodes.map((n) => graph.nodes[n].pos));
      startNodes.push(node);
      const s = new Stalker(physics, root, graph, bus, () => targets, audio, node, config.stalker, mats.glow, i, !authority);
      s.onCatch = (id) => this.onCaught(s, id);
      s.onInstinct = () => this.request({ k: 'instinct' });
      s.onWake = () => this.request({ k: 'wake', stalker: i });
      stalkers.push(s);
    }

    const interaction = new Interaction(
      physics, rendering.camera, input, player, props, items, inventory, house, objectives, distractions,
      {
        setPrompt: (text) => this.hud.setPrompt(text),
        onPickup: (item) => this.request({ k: 'pickup', item: item.id, by: this.myId }),
        onStep: (station, index) => this.request({ k: 'step', station: station.id, step: index, by: this.myId }),
        onExit: (route) => this.request({ k: 'escaped', id: this.myId, route }),
        onDistract: (d) => this.request({ k: 'distract', id: d.id, by: this.myId }),
        onShove: (prop, dir, point) => {
          props.shove(prop, dir, point);
          this.net?.send({
            t: this.net.hosting ? 'ev' : 'req',
            ev: { k: 'shove', prop: prop.id, d: dir.toArray(), p: point.toArray(), by: this.myId },
          } as Msg);
        },
        onFire: (origin, dir) => this.fireDart(origin, dir),
        hideTaken: (spot) => [...avatars.values()].some((a) => a.present && a.state!.hide === spot.id),
        onHide: (spot) => {
          this.lightWasOn = flashlight.on;
          flashlight.on = false;
          audio.playCreak(spot.door, 0.7);
          this.hud.blink();
          this.hud.setHidden(true);
        },
        onUnhide: () => {
          flashlight.on = this.lightWasOn && flashlight.battery > 0;
          audio.playCreak(player.position, 0.6);
          bus.emit(player.position, 5, 'prop');
          this.hud.blink();
          this.hud.setHidden(false);
        },
      },
    );
    const soundViz = new SoundVisualizer(root, bus);
    bus.subscribe((e) => {
      if (e.source !== 'footstep') this.noisePulse = Math.max(this.noisePulse, e.radius);
      // a client's noise only matters if the host's Granny hears it
      const net = this.net;
      if (net && !net.hosting && e.source !== 'distraction' && e.radius > 0 && this.state.is(GameState.Playing)) {
        net.send({ t: 'noise', x: e.position.x, y: e.position.y, z: e.position.z, r: e.radius });
      }
    });

    this.w = {
      config, night, diff, roster, root, physics, bus, house, props, floorboards, items, objectives, distractions,
      player, flashlight, inventory, interaction, graph, stalkers, prevStates: stalkers.map(() => StalkerState.Patrol),
      soundViz, avatars, targets, me, spawn,
    };

    this.lives = config.lives;
    this.catches = 0;
    this.levelTime = 0;
    this.warnedBattery = false;
    this.begun = false;
    this.downTimer = 0;
    this.escaped = false;
    this.escapedIds.clear();
    this.escapeIn = -1;
    this.immune.clear();
    this.wasHidden.clear();
    this.netTimer = 0;
    this.resetMood();
    player.syncCamera(0);
    house.update(0, 0, rendering.camera.position);

    const { hud } = this;
    hud.clearMessages();
    hud.setNight(config.id, `${config.name} · ${DIFFICULTIES[diff].label}`);
    hud.setLives(config.lives, config.lives);
    hud.setTime(0);
    hud.setThreat(0, false);
    hud.setSleep(0);
    hud.setTeam([]);
    this.refreshHud();
  }

  private unloadLevel(): void {
    const { root, physics } = this.w;
    this.rendering.scene.remove(root);
    disposeTree(root);
    physics.dispose();
    this.fx.clear();
  }

  private resetMood(): void {
    this.fear = 0;
    this.pulse = 0;
    this.fade = 0;
    this.noisePulse = 0;
    this.jumpscare.set(0);
    this.tension.reset();
    this.audio.setProximity(0);
  }

  // ---- she catches someone ------------------------------------------------

  /** Authority only: a catch costs the team one chance and sends the victim back to bed. */
  private onCaught(by: Stalker, id: string): void {
    const lives = Math.max(0, this.lives - 1);
    this.immune.set(id, DOWN_TIME + 2);
    // never leave her standing over the bed they are about to wake up in
    const { graph, stalkers, house } = this.w;
    const bedroom = house.spawns[0];
    if (by.position.distanceTo(bedroom) < 11) {
      const others = stalkers.filter((s) => s !== by).map((s) => s.position);
      by.reset(graph.farthestNode(bedroom, ...others), this.w.config.stalker.startDelay * 0.6);
    }
    this.request({ k: 'caught', id, lives });
    if (lives <= 0) this.request({ k: 'over', win: false, time: this.levelTime });
  }

  /** Left click with the crossbow: puts her to sleep if the shot is clean. */
  private fireDart(origin: THREE.Vector3, dir: THREE.Vector3): boolean {
    const { inventory, stalkers, physics } = this.w;
    if (!inventory.has('crossbow')) return false;
    let best = -1;
    let bestT = DART_RANGE;
    stalkers.forEach((s, i) => {
      if (s.asleep) return;
      const c = this.scratch.copy(s.position);
      c.y += 1.0;
      const t = c.clone().sub(origin).dot(dir);
      if (t < 0.3 || t > bestT) return;
      const miss = origin.clone().addScaledVector(dir, t).sub(c);
      if (Math.hypot(miss.x, miss.z) > 0.55 || Math.abs(miss.y) > 1.05) return;
      // walls and furniture stop a dart; bodies do not count
      if (physics.world.castRay(new RAPIER.Ray(origin, dir), t - 0.4, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC)) return;
      best = i;
      bestT = t;
    });
    if (best < 0) return false;
    if (!inventory.has('dart')) {
      this.hud.toast('No darts left', true);
      return true;
    }
    this.request({ k: 'dart', stalker: best, by: this.myId });
    return true;
  }

  // ---- frame --------------------------------------------------------------

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    this.lastFrame = performance.now();
    this.step(now, true);
  };

  /** One tick of the game. `render` is false for the ticks a hidden co-op tab runs to keep the night going. */
  private step(now: number, render: boolean): void {
    this.time.tick(now);
    const dt = this.time.delta;
    const { rendering } = this;
    if (this.state.is(GameState.Playing)) this.update(dt);
    else this.idle(dt);
    this.input.endFrame();
    if (!render) return;
    this.fx.update(dt, this.time.elapsed, rendering.renderer, rendering.camera, this.w.flashlight);
    this.hud.update(dt);
    rendering.render(dt, this.time.elapsed);
    this.watchFrameRate(now);
  }

  /** Drops the graphics a notch when the frame rate stays low: a slow frame rate is what makes the mouse feel heavy. */
  private watchFrameRate(now: number): void {
    const gap = now - this.lastTick;
    this.lastTick = now;
    if (!this.settings.autoQuality || !this.state.is(GameState.Playing) || gap > 500) {
      this.fpsFrames = 0;
      this.fpsSince = now;
      return;
    }
    this.fpsFrames++;
    const span = now - this.fpsSince;
    if (span < 4000) return;
    const fps = (this.fpsFrames * 1000) / span;
    this.fpsFrames = 0;
    this.fpsSince = now;
    const q = this.settings.quality;
    if (fps >= 40 || q === 'low') return;
    const lower: Quality = q === 'high' ? 'medium' : 'low';
    this.settings = { ...this.settings, quality: lower };
    Save.saveSettings(this.settings);
    this.setQuality(lower);
    this.hud.toast(`Graphics lowered to ${lower} for smoother controls`);
  }

  /** Menus and pause: the world holds still, but the lights, dust and camera keep breathing. */
  private idle(dt: number): void {
    const { house, items, flashlight } = this.w;
    const elapsed = this.time.elapsed;
    const camera = this.rendering.camera;
    const inMenu = this.state.is(GameState.Menu);
    if (inMenu) {
      // slow, uneasy drift across the hall behind the title
      camera.position.set(0.8 + Math.sin(elapsed * 0.11) * 0.5, 1.5 + Math.sin(elapsed * 0.5) * 0.02, 6.2);
      camera.rotation.set(Math.sin(elapsed * 0.17) * 0.05 - 0.02, 0.3 + Math.sin(elapsed * 0.13) * 0.3, 0);
      flashlight.update(dt, elapsed, camera, 0, false);
      this.tension.update(elapsed, { fear: 0.15, jump: 0, pulse: 0, fade: 0, hidden: false });
    }
    items.update(elapsed);
    house.update(elapsed, inMenu ? dt : 0, camera.position);
  }

  private update(dt: number): void {
    const { input, hud, audio, rendering } = this;
    const w = this.w;
    const { player, physics, props, floorboards, items, house, flashlight, stalkers, soundViz, objectives, distractions, me } = w;
    const elapsed = this.time.elapsed;
    const authority = this.authority;
    if (authority) this.levelTime += dt;

    if (input.wasPressed('KeyF') && !player.hidden && !this.escaped) {
      const was = flashlight.on;
      if (flashlight.toggle() !== was) audio.playUi();
    }
    if (DEV && input.wasPressed('Backquote')) soundViz.enabled = !soundViz.enabled;

    // ---- the local player ----
    const wasDown = this.downTimer > 0;
    this.downTimer = Math.max(0, this.downTimer - dt);
    if (wasDown && this.downTimer === 0) this.fade = 1;
    const attacker = stalkers.find((s) => s.state === StalkerState.Attack && s.preyId === this.myId);
    const frozen = !!attacker || this.downTimer > 0 || this.escaped;
    player.update(dt, frozen);
    if (attacker) player.lookAt(attacker.headPosition(this.scratch), dt);

    me.feet.copy(player.feet);
    me.eye.copy(player.eyePosition);
    me.hidden = player.hidden;
    me.crouching = player.crouching;
    me.lightOn = flashlight.on;
    me.active = !this.escaped && this.downTimer === 0;

    // ---- everyone else ----
    for (const [id, a] of w.avatars) {
      a.update(dt);
      const t = w.targets.find((x) => x.id === id)!;
      const s = a.state;
      t.hidden = !!s && s.hide >= 0;
      t.crouching = !!s && s.cr;
      t.lightOn = !!s && s.li;
      t.active = !!s && s.st === 0 && !(this.immune.get(id)! > 0);
    }

    if (authority) {
      for (const [id, left] of this.immune) this.immune.set(id, left - dt);
      if ((this.immune.get(this.myId) ?? 0) > 0) me.active = false;
      // a hiding place is blown if she watched them climb in
      for (const t of w.targets) {
        const was = this.wasHidden.get(t.id) ?? false;
        if (t.hidden && !was) {
          t.exposed = stalkers.some(
            (s) => s.sees(t.id) || (s.state === StalkerState.Chase && s.position.distanceTo(t.feet) < 5),
          );
          if (t.exposed) {
            if (t.id === this.myId) hud.toast('She saw you hide', true);
            else this.net?.sendTo(t.id, { t: 'toast', text: 'She saw you hide', warn: true });
          }
        } else if (!t.hidden) {
          t.exposed = false;
        }
        this.wasHidden.set(t.id, t.hidden);
      }
    }

    for (const s of stalkers) s.update(dt);
    props.beforeStep();
    physics.step(dt);
    props.afterStep(dt);
    player.syncCamera(dt);

    if (authority) {
      // she switches off whatever is making the racket once she reaches it
      for (const d of distractions.active()) {
        if (stalkers.some((s) => !s.asleep && s.position.distanceTo(d.pos) < 2.2)) this.request({ k: 'quiet', id: d.id });
      }
      if (this.escapeIn >= 0) {
        this.escapeIn -= dt;
        if (this.escapeIn <= 0) this.request({ k: 'over', win: true, time: this.levelTime });
      }
      if (!this.state.is(GameState.Playing)) return;
    }

    // stingers on state transitions
    stalkers.forEach((s, i) => {
      if (s.state === w.prevStates[i]) return;
      const forMe = s.preyId === this.myId || w.roster.length === 1;
      if (s.state === StalkerState.Chase && (forMe || s.position.distanceTo(player.position) < 12)) audio.playStinger();
      else if (s.state === StalkerState.Attack && forMe) audio.playScreech();
      w.prevStates[i] = s.state;
    });

    // fear: proximity always counts a little, being seen/hunted counts a lot
    let targetFear = 0;
    let tensionMax = 0;
    let alert = 0;
    let hunting = false;
    let sleep = 0;
    const here = player.position;
    for (const s of stalkers) {
      const t = s.tensionAt(here);
      const huntingMe = s.hunting && (s.preyId === this.myId || s.position.distanceTo(here) < 10);
      targetFear = Math.max(targetFear, Math.max(t, s.proximityAt(here) * 0.7) + (huntingMe ? 0.2 : 0));
      tensionMax = Math.max(tensionMax, t);
      alert = Math.max(alert, s.hunting && !huntingMe ? 0.5 : s.alert);
      hunting ||= huntingMe;
      sleep = Math.max(sleep, s.asleep ? s.sleepLeft : 0);
    }
    if (this.downTimer > 0 || this.escaped) targetFear = 0;
    this.fear += (Math.min(1, targetFear) - this.fear) * (1 - Math.exp(-dt * 2.5));
    const jump = attacker ? attacker.attackProgress : 0;
    if (audio.updateHeartbeat(dt, this.fear)) this.pulse = this.fear;
    this.pulse *= Math.exp(-dt * 5);
    this.fade = this.downTimer > 0 ? 1 : Math.max(0, this.fade - dt / 1.8);
    this.tension.update(elapsed, { fear: this.fear, jump, pulse: this.pulse, fade: this.fade, hidden: player.hidden });
    this.jumpscare.set(jump);
    audio.setProximity(this.fear);
    audio.updateAmbience(dt, rendering.camera.position);

    if (!this.escaped && this.downTimer === 0) {
      if (objectives.walkedOut(me.feet)) this.request({ k: 'escaped', id: this.myId, route: 'door' });
      floorboards.update(dt, me.feet, player.isMoving, player.crouching, player.isSprinting);
      w.interaction.update();
    } else {
      hud.setPrompt(null);
    }
    if (!this.state.is(GameState.Playing)) return;

    items.update(elapsed);
    objectives.update(dt, elapsed);
    distractions.update(dt, elapsed);
    house.update(elapsed, dt, rendering.camera.position);
    flashlight.update(dt, elapsed, rendering.camera, tensionMax);
    audio.updateListener(rendering.camera);
    soundViz.update(dt);

    if (!this.warnedBattery && flashlight.battery < 20) {
      this.warnedBattery = true;
      hud.toast('Flashlight battery low', true);
    }

    this.noisePulse = Math.max(0, this.noisePulse - 14 * dt);
    hud.setNoise(Math.max(player.noiseRadius, this.noisePulse) / NOISE_BAR_MAX);
    hud.setBattery(flashlight.battery);
    hud.setStamina(player.stamina.value);
    hud.setThreat(alert, hunting);
    hud.setTime(this.levelTime);
    hud.setSleep(Math.ceil(sleep));
    this.updateTeam(dt);
    this.sync(dt);

    if (DEV) {
      hud.setDebug(
        soundViz.enabled
          ? stalkers
              .map((s) => `STALKER ${StalkerState[s.state].toUpperCase()}  AWARE ${s.awareness.toFixed(2)}  SEES ${s.canSee}`)
              .join('\n') + `\nNIGHT ${w.night}  POS ${me.feet.x.toFixed(1)} ${me.feet.y.toFixed(1)} ${me.feet.z.toFixed(1)}`
          : null,
      );
    }
  }

  private myState(): PlayerState {
    const { player, flashlight, me } = this.w;
    const r = (n: number): number => Math.round(n * 100) / 100;
    return {
      x: r(me.feet.x), y: r(me.feet.y), z: r(me.feet.z), yaw: r(player.yaw), pitch: r(player.pitch),
      cr: player.crouching, li: flashlight.on, hide: player.hideId, sp: r(player.speed),
      st: this.escaped ? 2 : this.downTimer > 0 ? 1 : 0,
    };
  }

  /** Co-op: trade positions with the others a few times a second. */
  private sync(dt: number): void {
    const net = this.net;
    if (!net) return;
    this.netTimer -= dt;
    if (this.netTimer > 0) return;
    this.netTimer = 1 / NET_RATE;
    if (!net.hosting) return net.send({ t: 'me', s: this.myState() });
    const p: Record<string, PlayerState> = { [net.id]: this.myState() };
    for (const [id, a] of this.w.avatars) if (a.state) p[id] = a.state;
    net.send({
      t: 'world', p, s: this.w.stalkers.map((s) => s.snapshot()),
      time: Math.round(this.levelTime * 10) / 10, escapeIn: Math.round(this.escapeIn),
    });
  }

  private updateTeam(dt: number): void {
    if (this.w.roster.length < 2) return;
    this.teamTimer -= dt;
    if (this.teamTimer > 0) return;
    this.teamTimer = 0.5;
    const status = (id: string): string => {
      if (!this.present(id)) return 'left';
      if (this.escapedIds.has(id)) return 'out';
      const s = id === this.myId ? this.myState() : this.w.avatars.get(id)?.state;
      if (!s) return '';
      return s.st === 1 ? 'caught' : s.hide >= 0 ? 'hiding' : s.y > 2 ? 'upstairs' : 'downstairs';
    };
    this.hud.setTeam(
      this.w.roster.map((p) => ({
        name: p.name, color: css(PLAYER_COLORS[p.slot % PLAYER_COLORS.length]), status: status(p.id), me: p.id === this.myId,
      })),
    );
    if (this.escaped && this.menu.current === 'escaped') this.showEscaped();
  }
}
