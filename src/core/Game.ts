import * as THREE from 'three';
import { GameTime } from './Time';
import { GameState, StateManager } from './StateManager';
import { Input } from './Input';
import { Physics } from './Physics';
import { LEVELS, LevelConfig } from './Levels';
import { Progress, Save, Settings } from './Save';
import { GameRenderer, SHADOW_SIZE } from '../rendering/GameRenderer';
import { createMaterials, Materials } from '../rendering/Materials';
import { TensionEffects } from '../rendering/TensionEffects';
import { Effects } from '../rendering/Effects';
import { AudioManager } from '../audio/AudioManager';
import { SoundBus } from '../ai/SoundBus';
import { Stalker, StalkerState } from '../ai/Stalker';
import { WaypointGraph, waypointsFor } from '../ai/Waypoints';
import { House } from '../environment/House';
import { PropManager } from '../environment/Props';
import { Floorboards } from '../environment/Floorboards';
import { Pickups } from '../environment/Pickups';
import { PlayerController } from '../player/PlayerController';
import { Flashlight } from '../player/Flashlight';
import { Inventory } from '../player/Inventory';
import { Interaction } from '../player/Interaction';
import { HUD } from '../ui/HUD';
import { Menu, MenuAction } from '../ui/Menu';
import { SoundVisualizer } from '../ui/SoundVisualizer';
import { JumpscareOverlay } from '../ui/JumpscareOverlay';

/** Noise radius (m) that fills the HUD noise bar. */
const NOISE_BAR_MAX = 20;
const BATTERY_CHARGE = 50;
const DEV = import.meta.env.DEV;

/** Everything that is rebuilt from scratch for each night. */
interface World {
  config: LevelConfig;
  root: THREE.Group;
  physics: Physics;
  bus: SoundBus;
  house: House;
  props: PropManager;
  floorboards: Floorboards;
  pickups: Pickups;
  player: PlayerController;
  flashlight: Flashlight;
  inventory: Inventory;
  interaction: Interaction;
  graph: WaypointGraph;
  stalkers: Stalker[];
  spawnNodes: number[];
  prevStates: StalkerState[];
  soundViz: SoundVisualizer;
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
  private progress: Progress = Save.loadProgress(LEVELS.length);
  private w!: World;

  private catches = 0;
  private levelTime = 0;
  private noisePulse = 0;
  private fear = 0;
  private pulse = 0;
  private fade = 0;
  private lightWasOn = true;
  private warnedBattery = false;

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
      touched: () => {
        this.audio.start();
        this.audio.playUi();
      },
      act: (action, arg) => this.act(action, arg),
      applySettings: (s) => this.applySettings(s),
    });
    this.input.onLockChange = (locked) => this.onLockChange(locked);

    this.loadLevel(this.progress.unlocked);
    this.menu.show('main');
  }

  static async create(container: HTMLElement): Promise<Game> {
    await Physics.init();
    return new Game(container);
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  // ---- flow ---------------------------------------------------------------

  private act(action: MenuAction, arg?: string): void {
    switch (action) {
      case 'continue':
        this.startLevel(this.progress.unlocked);
        break;
      case 'new':
        this.startLevel(1);
        break;
      case 'play':
        this.startLevel(Number(arg));
        break;
      case 'restart':
        this.startLevel(this.w.config.id);
        break;
      case 'next':
        this.startLevel(this.w.config.id + 1);
        break;
      case 'resume':
      case 'lock':
        this.input.requestLock();
        break;
      case 'quit':
        this.toMenu();
        break;
    }
  }

  private startLevel(id: number): void {
    const n = THREE.MathUtils.clamp(Math.floor(id) || 1, 1, Math.min(LEVELS.length, this.progress.unlocked));
    this.loadLevel(n);
    this.state.set(GameState.Intro);
    this.audio.setDucked(false);
    this.hud.setVisible(false);
    // shown only until the pointer lock lands (or if the browser refuses the first request)
    this.menu.show('intro', { night: n });
    this.input.requestLock();
  }

  private toMenu(): void {
    this.state.set(GameState.Menu);
    this.resetMood();
    this.respawn();
    this.audio.setDucked(false);
    this.hud.setVisible(false);
    this.hud.clearMessages();
    this.menu.show('main');
  }

  private onLockChange(locked: boolean): void {
    if (locked) {
      if (!this.state.is(GameState.Intro, GameState.Paused, GameState.Caught)) return;
      if (this.state.is(GameState.Caught)) this.respawn();
      if (this.state.is(GameState.Intro)) this.beginNight();
      this.state.set(GameState.Playing);
      this.menu.hide();
      this.hud.setVisible(true);
      this.audio.start();
      this.audio.setDucked(false);
    } else if (this.state.is(GameState.Playing)) {
      this.state.set(GameState.Paused);
      this.audio.setDucked(true);
      this.menu.show('pause', { night: this.w.config.id });
    }
  }

  private beginNight(): void {
    const c = this.w.config;
    this.fade = 1;
    this.hud.showBanner(`NIGHT ${c.id}`, c.name, c.hint);
  }

  private onCaught(): void {
    const c = this.w.config;
    this.catches++;
    const left = c.lives - this.catches;
    this.jumpscare.set(0);
    this.hud.setLives(left, c.lives);
    this.hud.clearMessages();
    this.audio.setDucked(true);
    this.state.set(left > 0 ? GameState.Caught : GameState.GameOver);
    document.exitPointerLock();
    if (left > 0) {
      this.menu.show('caught', { night: c.id, livesLeft: left });
    } else {
      this.audio.playGameOver();
      this.menu.show('gameover', { night: c.id });
    }
  }

  private onEscaped(): void {
    const c = this.w.config;
    const last = c.id === LEVELS.length;
    const prev = this.progress.best[c.id];
    const newBest = prev === undefined || this.levelTime < prev;
    if (newBest) this.progress.best[c.id] = this.levelTime;
    this.progress.unlocked = Math.max(this.progress.unlocked, Math.min(LEVELS.length, c.id + 1));
    if (last) this.progress.finished = true;
    Save.saveProgress(this.progress);

    this.state.set(last ? GameState.Victory : GameState.LevelComplete);
    document.exitPointerLock();
    this.resetMood();
    this.hud.setVisible(false);
    this.audio.playEscape();
    this.menu.show(last ? 'victory' : 'complete', {
      night: c.id,
      time: this.levelTime,
      best: this.progress.best[c.id],
      newBest: newBest && prev !== undefined,
      catches: this.catches,
    });
  }

  private applySettings(s: Settings): void {
    const qualityChanged = s.quality !== this.settings.quality;
    this.settings = s;
    Save.saveSettings(s);
    this.audio.setVolume(s.volume);
    this.w.player.sensitivity = s.sensitivity;
    if (qualityChanged) {
      this.rendering.setQuality(s.quality);
      this.w.flashlight.setShadowSize(SHADOW_SIZE[s.quality]);
    }
  }

  // ---- level lifecycle ----------------------------------------------------

  private loadLevel(id: number): void {
    if (this.w) this.unloadLevel();
    const config = LEVELS[id - 1];
    const { rendering, input, audio, mats, fx } = this;

    const physics = new Physics();
    const root = new THREE.Group();
    rendering.scene.add(root);
    rendering.setAtmosphere(config.fog, config.blackout ? 0.2 : 0.2 + 0.15 * config.lightScale);

    const bus = new SoundBus();
    const house = new House(physics, mats, config);
    const props = new PropManager(physics, mats, bus, audio, fx, config.areas);
    const floorboards = new Floorboards(mats, bus, audio, config);
    const pickups = new Pickups(mats, config);
    root.add(house.group, props.group, floorboards.group, pickups.group);
    house.onSpark = (pos) => {
      fx.sparks(pos);
      audio.playSpark(pos);
    };

    const player = new PlayerController(physics, rendering.camera, input, audio, bus, house.spawn);
    player.sensitivity = this.settings.sensitivity;
    const flashlight = new Flashlight(root, mats.cookie, config.batteryDrain, SHADOW_SIZE[this.settings.quality]);
    const inventory = new Inventory(config.keys);

    physics.step(1 / 60); // populates the query pipeline so the graph's raycasts see the walls
    const graph = new WaypointGraph(physics, waypointsFor(config.areas));
    if (DEV) {
      const lost = graph.unreachable();
      if (lost.length) console.warn(`[night ${id}] unreachable waypoints:`, lost.map((i) => graph.nodes[i].pos));
    }

    const stalkers: Stalker[] = [];
    const spawnNodes: number[] = [];
    for (let i = 0; i < config.stalkers; i++) {
      // as far from the player — and from each other — as the cellar allows
      const node = graph.farthestNode(house.spawn, ...spawnNodes.map((n) => graph.nodes[n].pos));
      spawnNodes.push(node);
      const s = new Stalker(physics, root, graph, bus, player, flashlight, audio, node, config.stalker, mats.glow, i);
      s.onCatch = () => this.onCaught();
      s.onInstinct = () => this.hud.toast('SOMETHING STIRS… SHE IS COMING YOUR WAY', true);
      stalkers.push(s);
    }

    const interaction = new Interaction(physics, rendering.camera, input, player, props, pickups, inventory, house, {
      setPrompt: (text) => this.hud.setPrompt(text),
      isWatched: () =>
        stalkers.some(
          (s) => s.canSee || (s.state === StalkerState.Chase && s.position.distanceTo(player.position) < 5),
        ),
      onPickup: (item) => {
        audio.playPickup();
        if (item.type === 'key') {
          inventory.keys++;
          fx.sparkle(item.mesh.position, 0xffc860);
          this.hud.setKeys(inventory.keys, inventory.keysRequired);
          this.hud.toast(
            inventory.hasAllKeys
              ? 'ALL KEYS FOUND — GET TO THE CELLAR DOOR'
              : `KEY ${inventory.keys} OF ${inventory.keysRequired}`,
          );
        } else {
          inventory.batteries++;
          flashlight.addBattery(BATTERY_CHARGE);
          this.warnedBattery = false;
          fx.sparkle(item.mesh.position, 0x70ff80);
          this.hud.toast(`BATTERY +${BATTERY_CHARGE}%`);
        }
      },
      onHide: (spot, watched) => {
        this.lightWasOn = flashlight.on;
        flashlight.on = false;
        audio.playCreak(spot.door, 0.7);
        this.hud.blink();
        this.hud.setHidden(true);
        if (watched) this.hud.toast('SHE SAW YOU CLIMB IN', true);
      },
      onUnhide: () => {
        flashlight.on = this.lightWasOn && flashlight.battery > 0;
        audio.playCreak(player.position, 0.6);
        bus.emit(player.position, 5, 'prop');
        this.hud.blink();
        this.hud.setHidden(false);
      },
      onUnlock: () => {
        audio.playImpact(house.doorPos, 0.8, true);
        audio.playDoorOpen(house.doorPos);
        fx.doorDust(house.doorPos);
        bus.emit(house.doorPos, 22, 'prop'); // the grinding door carries through the whole cellar
        this.hud.toast('THE DOOR IS OPENING — RUN');
      },
    });
    const soundViz = new SoundVisualizer(root, bus);
    bus.subscribe((e) => {
      if (e.source !== 'footstep') this.noisePulse = Math.max(this.noisePulse, e.radius);
    });

    this.w = {
      config, root, physics, bus, house, props, floorboards, pickups, player, flashlight, inventory,
      interaction, graph, stalkers, spawnNodes, prevStates: stalkers.map(() => StalkerState.Patrol), soundViz,
    };

    this.catches = 0;
    this.levelTime = 0;
    this.warnedBattery = false;
    this.resetMood();
    player.syncCamera(0);

    const { hud } = this;
    hud.clearMessages();
    hud.setNight(config.id, config.name);
    hud.setKeys(0, config.keys);
    hud.setLives(config.lives, config.lives);
    hud.setTime(0);
    hud.setThreat(0, false);
  }

  private unloadLevel(): void {
    const { root, physics } = this.w;
    this.rendering.scene.remove(root);
    disposeTree(root);
    physics.dispose();
    this.fx.clear();
  }

  private respawn(): void {
    const { player, stalkers, spawnNodes, house, flashlight } = this.w;
    player.teleport(house.spawn);
    player.yaw = 0;
    player.pitch = 0;
    if (flashlight.battery > 0) flashlight.on = true;
    stalkers.forEach((s, i) => s.reset(spawnNodes[i]));
    this.w.prevStates.fill(StalkerState.Patrol);
    this.hud.setHidden(false);
    this.resetMood();
    player.syncCamera(0);
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

  // ---- frame --------------------------------------------------------------

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    this.time.tick(now);
    const dt = this.time.delta;
    const { rendering } = this;
    if (this.state.is(GameState.Playing)) this.update(dt);
    else this.idle(dt);
    this.fx.update(dt, this.time.elapsed, rendering.renderer, rendering.camera, this.w.flashlight);
    this.hud.update(dt);
    rendering.render(dt, this.time.elapsed);
    this.input.endFrame();
  };

  /** Menus and pause: the world holds still, but the lights, dust and camera keep breathing. */
  private idle(dt: number): void {
    const { house, pickups, flashlight } = this.w;
    const elapsed = this.time.elapsed;
    const camera = this.rendering.camera;
    if (this.state.is(GameState.Menu)) {
      // slow, uneasy drift across the hall behind the title
      camera.position.set(Math.sin(elapsed * 0.11) * 0.5, 1.5 + Math.sin(elapsed * 0.5) * 0.02, 3.6);
      camera.rotation.set(Math.sin(elapsed * 0.17) * 0.05 - 0.02, 0.35 + Math.sin(elapsed * 0.13) * 0.3, 0);
      flashlight.update(dt, elapsed, camera, 0, false);
      this.tension.update(elapsed, { fear: 0.15, jump: 0, pulse: 0, fade: 0, hidden: false });
    }
    pickups.update(elapsed);
    house.update(elapsed, this.state.is(GameState.Menu) ? dt : 0);
  }

  private update(dt: number): void {
    const { input, hud, audio, rendering } = this;
    const { config, player, physics, props, floorboards, pickups, house, flashlight, stalkers, soundViz } = this.w;
    const elapsed = this.time.elapsed;
    this.levelTime += dt;

    if (input.wasPressed('KeyF') && !player.hidden) {
      const was = flashlight.on;
      if (flashlight.toggle() !== was) audio.playUi();
    }
    if (DEV && input.wasPressed('Backquote')) soundViz.enabled = !soundViz.enabled;

    const attacker = stalkers.find((s) => s.state === StalkerState.Attack);
    player.update(dt, !!attacker);
    if (attacker) {
      player.lookAt(attacker.headPosition(this.scratch), dt);
      for (const s of stalkers) if (s !== attacker) s.frozen = true;
    }
    for (const s of stalkers) s.update(dt);
    props.beforeStep();
    physics.step(dt);
    props.afterStep(dt);
    player.syncCamera(dt);

    // stingers on state transitions
    stalkers.forEach((s, i) => {
      if (s.state === this.w.prevStates[i]) return;
      if (s.state === StalkerState.Chase) audio.playStinger();
      else if (s.state === StalkerState.Attack) audio.playScreech();
      this.w.prevStates[i] = s.state;
    });

    // fear: proximity always counts a little, being seen/hunted counts a lot
    let targetFear = 0;
    let tensionMax = 0;
    let alert = 0;
    let hunting = false;
    for (const s of stalkers) {
      targetFear = Math.max(targetFear, Math.max(s.tension, s.proximity * 0.7) + (s.canSee ? 0.2 : 0));
      tensionMax = Math.max(tensionMax, s.tension);
      alert = Math.max(alert, s.alert);
      hunting ||= s.hunting;
    }
    this.fear += (Math.min(1, targetFear) - this.fear) * (1 - Math.exp(-dt * 2.5));
    const jump = attacker ? attacker.attackProgress : 0;
    if (audio.updateHeartbeat(dt, this.fear)) this.pulse = this.fear;
    this.pulse *= Math.exp(-dt * 5);
    this.fade = Math.max(0, this.fade - dt / 1.8);
    this.tension.update(elapsed, {
      fear: this.fear, jump, pulse: this.pulse, fade: this.fade, hidden: player.hidden,
    });
    this.jumpscare.set(jump);
    audio.setProximity(this.fear);
    audio.updateAmbience(dt, rendering.camera.position);

    if (house.doorOpen && player.position.z > 6.2) {
      this.onEscaped();
      return;
    }

    floorboards.update(dt, player.position, player.isMoving, player.crouching, player.isSprinting);
    this.w.interaction.update();
    pickups.update(elapsed);
    house.update(elapsed, dt);
    flashlight.update(dt, elapsed, rendering.camera, tensionMax);
    audio.updateListener(rendering.camera);
    soundViz.update(dt);

    if (!this.warnedBattery && flashlight.battery < 20) {
      this.warnedBattery = true;
      hud.toast('FLASHLIGHT BATTERY LOW', true);
    }

    this.noisePulse = Math.max(0, this.noisePulse - 14 * dt);
    hud.setNoise(Math.max(player.noiseRadius, this.noisePulse) / NOISE_BAR_MAX);
    hud.setBattery(flashlight.battery);
    hud.setStamina(player.stamina.value);
    hud.setThreat(alert, hunting);
    hud.setTime(this.levelTime);
    if (DEV) {
      hud.setDebug(
        soundViz.enabled
          ? stalkers
              .map((s) => `STALKER ${StalkerState[s.state].toUpperCase()}  AWARE ${s.awareness.toFixed(2)}  SEES ${s.canSee}`)
              .join('\n') + `\nNIGHT ${config.id}`
          : null,
      );
    }
  }
}
