export interface StalkerTuning {
  patrol: number;
  investigate: number;
  chase: number;
  /** Multiplier on how far away she registers a sound. */
  hearing: number;
  /** Sight range (m) while the player's flashlight is on / off. */
  visionLit: number;
  visionDark: number;
  /** Multiplier on how fast seeing the player turns into a chase. */
  awareness: number;
  /** Seconds she keeps chasing without line of sight. */
  loseTime: number;
  /** Seconds she lingers where she last heard / saw something. */
  searchTime: number;
  /** Seconds between "instinct" pulses that draw her toward a player. 0 = never. */
  senseInterval: number;
  /** Seconds she stands still at the start of a night and after catching someone. */
  startDelay: number;
}

export interface LevelConfig {
  id: number;
  name: string;
  tagline: string;
  hint: string;
  /** Door keys the front-door locks need. */
  keys: number;
  batteries: number;
  /** Battery percent drained per second while the flashlight is on. */
  batteryDrain: number;
  /** Chances the team shares; each catch costs one. */
  lives: number;
  stalkers: number;
  /** Sleeping darts hidden in the house. */
  darts: number;
  /** Multiplier on the house lamps. */
  lightScale: number;
  /** Lamps are dead and only surge at random. */
  blackout: boolean;
  fog: number;
  creakZones: number;
  stalker: StalkerTuning;
}

export type Difficulty = 'easy' | 'medium' | 'hard';

interface DifficultyTuning {
  label: string;
  blurb: string;
  /** Multiplier on all of her movement speeds. */
  speed: number;
  /** Multiplier on her hearing and sight range. */
  senses: number;
  /** Multiplier on how quickly a glimpse becomes a chase. */
  awareness: number;
  lives: number;
  darts: number;
  startDelay: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyTuning> = {
  easy: {
    label: 'Easy',
    blurb: 'She is slower than your walk, half deaf and forgetful. 5 chances, 4 darts.',
    speed: 0.74, senses: 0.75, awareness: 0.6, lives: 5, darts: 4, startDelay: 14,
  },
  medium: {
    label: 'Medium',
    blurb: 'She keeps pace with a brisk walk. Running is the only way out of a chase. 4 chances, 3 darts.',
    speed: 0.9, senses: 1, awareness: 1, lives: 4, darts: 3, startDelay: 9,
  },
  hard: {
    label: 'Hard',
    blurb: 'Fast, sharp-eared and quick to notice. 3 chances, 2 darts.',
    speed: 1.05, senses: 1.2, awareness: 1.35, lives: 3, darts: 2, startDelay: 6,
  },
};

export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'medium', 'hard'];

/** How long a sleeping dart keeps her down, in seconds. */
export const SLEEP_SECONDS = 120;

type NightBase = Omit<LevelConfig, 'lives' | 'darts' | 'stalker'> & { stalker: Omit<StalkerTuning, 'startDelay'> };

/** Five nights, each one meaner than the last. Difficulty scales these further. */
const NIGHTS: NightBase[] = [
  {
    id: 1,
    name: 'The House',
    tagline: 'She is old. She is slow. She hears everything.',
    hint: 'Find a way out: the front door, the car in the garage, or the balcony.',
    keys: 3,
    batteries: 3,
    batteryDrain: 0.3,
    stalkers: 1,
    lightScale: 1,
    blackout: false,
    fog: 0.07,
    creakZones: 5,
    stalker: {
      patrol: 1.5, investigate: 2.2, chase: 3.4, hearing: 1, visionLit: 11, visionDark: 6,
      awareness: 0.9, loseTime: 5, searchTime: 3, senseInterval: 0,
    },
  },
  {
    id: 2,
    name: 'Dim Lamps',
    tagline: 'Half the bulbs have gone. She does not need them.',
    hint: 'The lamps are failing and more boards creak. Three ways out, same as before.',
    keys: 3,
    batteries: 3,
    batteryDrain: 0.36,
    stalkers: 1,
    lightScale: 0.7,
    blackout: false,
    fog: 0.08,
    creakZones: 8,
    stalker: {
      patrol: 1.7, investigate: 2.5, chase: 3.7, hearing: 1.15, visionLit: 12.5, visionDark: 6.5,
      awareness: 1.1, loseTime: 6, searchTime: 3.5, senseInterval: 0,
    },
  },
  {
    id: 3,
    name: 'Blackout',
    tagline: 'The fuses are gone. Your flashlight is all you have.',
    hint: 'The house is dark and batteries drain faster. The front door needs 4 keys.',
    keys: 4,
    batteries: 4,
    batteryDrain: 0.45,
    stalkers: 1,
    lightScale: 0.9,
    blackout: true,
    fog: 0.09,
    creakZones: 10,
    stalker: {
      patrol: 1.8, investigate: 2.7, chase: 3.9, hearing: 1.3, visionLit: 14, visionDark: 7.5,
      awareness: 1.25, loseTime: 7, searchTime: 4, senseInterval: 0,
    },
  },
  {
    id: 4,
    name: 'The Hunt',
    tagline: 'She no longer waits for you to make a mistake.',
    hint: 'She can sense where you are. Keep moving; keep a dart ready.',
    keys: 4,
    batteries: 4,
    batteryDrain: 0.48,
    stalkers: 1,
    lightScale: 0.6,
    blackout: false,
    fog: 0.095,
    creakZones: 12,
    stalker: {
      patrol: 2.0, investigate: 3.0, chase: 4.15, hearing: 1.45, visionLit: 15, visionDark: 8,
      awareness: 1.5, loseTime: 8, searchTime: 4.5, senseInterval: 45,
    },
  },
  {
    id: 5,
    name: 'No Way Out',
    tagline: 'She was never alone in this house.',
    hint: 'There are two of them, and the front door needs 5 keys.',
    keys: 5,
    batteries: 4,
    batteryDrain: 0.5,
    stalkers: 2,
    lightScale: 0.5,
    blackout: false,
    fog: 0.1,
    creakZones: 14,
    stalker: {
      patrol: 2.0, investigate: 3.0, chase: 4.25, hearing: 1.5, visionLit: 15, visionDark: 8,
      awareness: 1.7, loseTime: 9, searchTime: 5, senseInterval: 60,
    },
  },
];

export const NIGHT_COUNT = NIGHTS.length;

export const nightName = (id: number): string => NIGHTS[id - 1]?.name ?? '';

/** The night's numbers with the chosen difficulty folded in. `players` adds a dart per extra player. */
export function levelFor(id: number, difficulty: Difficulty, players = 1): LevelConfig {
  const n = NIGHTS[Math.min(NIGHTS.length, Math.max(1, id)) - 1];
  const d = DIFFICULTIES[difficulty];
  const s = n.stalker;
  return {
    ...n,
    lives: d.lives + Math.max(0, players - 1),
    // a second stalker needs a second dart to be worth carrying
    darts: d.darts + (n.stalkers > 1 ? 1 : 0) + Math.floor(Math.max(0, players - 1) / 2),
    stalker: {
      patrol: s.patrol * d.speed,
      investigate: s.investigate * d.speed,
      chase: s.chase * d.speed,
      hearing: s.hearing * d.senses,
      visionLit: s.visionLit * d.senses,
      visionDark: s.visionDark * d.senses,
      awareness: s.awareness * d.awareness,
      loseTime: s.loseTime,
      searchTime: s.searchTime,
      senseInterval: s.senseInterval,
      startDelay: d.startDelay,
    },
  };
}
