import { Vector3 } from 'three';
import { GameTime } from './Time';
import { GameState, StateManager } from './StateManager';
import { Input } from './Input';
import { Physics } from './Physics';
import { GameRenderer } from '../rendering/GameRenderer';
import { createMaterials } from '../rendering/Materials';
import { AudioManager } from '../audio/AudioManager';
import { SoundBus } from '../ai/SoundBus';
import { Stalker, StalkerState } from '../ai/Stalker';
import { WaypointGraph } from '../ai/Waypoints';
import { House } from '../environment/House';
import { PropManager } from '../environment/Props';
import { Floorboards } from '../environment/Floorboards';
import { Pickups } from '../environment/Pickups';
import { PlayerController } from '../player/PlayerController';
import { Flashlight } from '../player/Flashlight';
import { Inventory } from '../player/Inventory';
import { Interaction } from '../player/Interaction';
import { HUD } from '../ui/HUD';
import { SoundVisualizer } from '../ui/SoundVisualizer';
import { JumpscareOverlay } from '../ui/JumpscareOverlay';
import { TensionEffects } from '../rendering/TensionEffects';

const MAX_CATCHES = 3;

interface Systems {
  effects: TensionEffects;
  jumpscare: JumpscareOverlay;
  stalker: Stalker;
  graph: WaypointGraph;
  physics: Physics;
  rendering: GameRenderer;
  input: Input;
  audio: AudioManager;
  bus: SoundBus;
  house: House;
  props: PropManager;
  floorboards: Floorboards;
  pickups: Pickups;
  player: PlayerController;
  flashlight: Flashlight;
  inventory: Inventory;
  interaction: Interaction;
  hud: HUD;
  soundViz: SoundVisualizer;
}

/** Noise radius (m) that fills the HUD noise bar. */
const NOISE_BAR_MAX = 20;

export class Game {
  readonly time = new GameTime();
  readonly state = new StateManager();
  catches = 0;
  private noisePulse = 0;
  private fear = 0;
  private prevStalkerState = StalkerState.Patrol;

  private constructor(readonly s: Systems) {
    const { input, hud, audio, bus, inventory } = s;
    s.stalker.onCatch = () => this.onCaught();
    input.onLockChange = (locked) => {
      if (locked) {
        if (this.state.is(GameState.Caught)) this.respawn();
        this.state.set(GameState.Playing);
      } else if (this.state.is(GameState.Playing)) {
        this.state.set(GameState.Paused);
      }
    };
    this.state.onChange((next) => {
      if (next === GameState.Playing) {
        hud.showOverlay(false);
        audio.start();
      } else if (next === GameState.Paused) {
        hud.showOverlay(true, 'PAUSED', 'CLICK TO RESUME');
        audio.suspend();
      }
    });
    bus.subscribe((e) => {
      if (e.source !== 'footstep') this.noisePulse = Math.max(this.noisePulse, e.radius);
    });
    hud.setKeys(inventory.keys, inventory.keysRequired);
  }

  static async create(container: HTMLElement): Promise<Game> {
    const physics = await Physics.create();
    const rendering = new GameRenderer(container);
    const input = new Input(rendering.canvas);
    const audio = new AudioManager();
    const bus = new SoundBus();
    const mats = createMaterials();

    const house = new House(physics, mats);
    const props = new PropManager(physics, mats, bus, audio);
    const floorboards = new Floorboards(mats, bus, audio);
    const pickups = new Pickups();
    rendering.scene.add(house.group, props.group, floorboards.group, pickups.group);

    const player = new PlayerController(physics, rendering.camera, input, audio, bus, house.spawn);
    const flashlight = new Flashlight(rendering.scene);
    const inventory = new Inventory();
    let game!: Game;
    const hud = new HUD(() => game.onOverlayClick());
    physics.step(1 / 60); // populates the query pipeline so the graph's raycasts see the walls
    const graph = new WaypointGraph(physics);
    const stalker = new Stalker(
      physics, rendering.scene, graph, bus, player, flashlight, audio, graph.farthestNode(house.spawn),
    );
    const interaction = new Interaction(
      physics, rendering.camera, input, audio, player, props, pickups, inventory, flashlight, hud, house, bus,
    );
    const effects = new TensionEffects(rendering.post, rendering.camera);
    const jumpscare = new JumpscareOverlay();
    const soundViz = new SoundVisualizer(rendering.scene, bus);

    game = new Game({
      effects, jumpscare, stalker, graph,
      physics, rendering, input, audio, bus, house, props, floorboards, pickups,
      player, flashlight, inventory, interaction, hud, soundViz,
    });
    player.syncCamera(0);
    return game;
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  onOverlayClick(): void {
    const over = this.state.is(GameState.Caught) && this.catches >= MAX_CATCHES;
    if (over || this.state.is(GameState.Escaped)) location.reload();
    else this.s.input.requestLock();
  }

  private onEscaped(): void {
    this.state.set(GameState.Escaped);
    document.exitPointerLock();
    this.s.hud.showOverlay(true, 'YOU ESCAPED', 'CLICK TO PLAY AGAIN');
  }

  private onCaught(): void {
    this.catches++;
    this.s.jumpscare.set(0);
    this.state.set(GameState.Caught);
    document.exitPointerLock();
    const over = this.catches >= MAX_CATCHES;
    this.s.hud.showOverlay(
      true,
      over ? 'GAME OVER' : 'CAUGHT',
      over ? 'CLICK TO START OVER' : `CLICK TO TRY AGAIN (${this.catches}/${MAX_CATCHES} CAUGHT)`,
    );
  }

  private respawn(): void {
    const { player, stalker, graph, house } = this.s;
    player.teleport(house.spawn);
    player.yaw = 0;
    player.pitch = 0;
    stalker.reset(graph.farthestNode(house.spawn));
    this.prevStalkerState = StalkerState.Patrol;
    this.fear = 0;
    this.s.jumpscare.set(0);
    this.s.effects.reset();
  }

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    this.time.tick(now);
    const dt = this.time.delta;
    if (this.state.is(GameState.Playing)) this.update(dt);
    this.s.rendering.render(dt, this.time.elapsed);
    this.s.input.endFrame();
  };

  private update(dt: number): void {
    const { input, player, physics, props, floorboards, pickups, house, flashlight, audio, rendering, hud } = this.s;
    const elapsed = this.time.elapsed;

    if (input.wasPressed('KeyF')) flashlight.toggle();
    if (input.wasPressed('Backquote')) this.s.soundViz.enabled = !this.s.soundViz.enabled;

    const { stalker } = this.s;
    const attacking = stalker.state === StalkerState.Attack;
    player.update(dt, attacking);
    if (attacking) player.lookAt(stalker.headPosition(new Vector3()), dt);
    stalker.update(dt);
    props.beforeStep();
    physics.step(dt);
    props.afterStep(dt);
    player.syncCamera(dt);

    // stingers on state transitions
    if (stalker.state !== this.prevStalkerState) {
      if (stalker.state === StalkerState.Chase) audio.playStinger();
      else if (stalker.state === StalkerState.Attack) audio.playScreech();
      this.prevStalkerState = stalker.state;
    }

    // fear: proximity always counts a little, being seen/hunted counts a lot
    const targetFear = Math.min(
      1,
      Math.max(stalker.tension, stalker.proximity * 0.7) + (stalker.canSee ? 0.2 : 0),
    );
    this.fear += (targetFear - this.fear) * (1 - Math.exp(-dt * 2.5));
    const jump = stalker.attackProgress;
    this.s.effects.update(elapsed, this.fear, jump);
    this.s.jumpscare.set(jump);
    audio.updateHeartbeat(dt, this.fear);
    audio.setProximity(this.fear);

    if (house.doorOpen && player.position.z > 6.2) this.onEscaped();

    floorboards.update(dt, player.position, player.isMoving, player.crouching, player.isSprinting);
    this.s.interaction.update();
    pickups.update(elapsed);
    house.update(elapsed, dt);
    flashlight.update(dt, elapsed, rendering.camera, stalker.tension);
    audio.updateListener(rendering.camera);
    this.s.soundViz.update(dt);

    this.noisePulse = Math.max(0, this.noisePulse - 14 * dt);
    hud.setNoise(Math.max(player.noiseRadius, this.noisePulse) / NOISE_BAR_MAX);
    hud.setBattery(flashlight.battery);
    hud.setStamina(player.stamina.value);
    hud.setDebug(
      this.s.soundViz.enabled
        ? `STALKER ${StalkerState[stalker.state].toUpperCase()}  AWARE ${stalker.awareness.toFixed(2)}  SEES ${stalker.canSee}`
        : null,
    );
  }
}
