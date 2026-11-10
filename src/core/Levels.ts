export type AreaId = 'hall' | 'east' | 'north' | 'west' | 'crypt';

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
  /** Seconds between "instinct" pulses that draw her toward the player. 0 = never. */
  senseInterval: number;
}

export interface LevelConfig {
  id: number;
  name: string;
  tagline: string;
  hint: string;
  areas: AreaId[];
  keys: number;
  batteries: number;
  /** Battery percent drained per second while the flashlight is on. */
  batteryDrain: number;
  lives: number;
  stalkers: number;
  /** Multiplier on the cellar's bulbs. */
  lightScale: number;
  /** Bulbs are dead and only surge at random. */
  blackout: boolean;
  fog: number;
  creakZones: number;
  stalker: StalkerTuning;
}

/** Five nights, each one meaner than the last. */
export const LEVELS: LevelConfig[] = [
  {
    id: 1,
    name: 'The Cellar',
    tagline: 'She is old. She is slow. She hears everything.',
    hint: 'Find 3 keys and unlock the cellar door.',
    areas: ['hall', 'east', 'north'],
    keys: 3,
    batteries: 2,
    batteryDrain: 0.45,
    lives: 3,
    stalkers: 1,
    lightScale: 1,
    blackout: false,
    fog: 0.085,
    creakZones: 3,
    stalker: {
      patrol: 1.5, investigate: 2.2, chase: 3.4, hearing: 1, visionLit: 11, visionDark: 6,
      awareness: 0.9, loseTime: 5, searchTime: 3, senseInterval: 0,
    },
  },
  {
    id: 2,
    name: 'The West Wing',
    tagline: 'The boards are off the west door. Something moved them.',
    hint: 'Find 4 keys. The west wing is open now.',
    areas: ['hall', 'east', 'north', 'west'],
    keys: 4,
    batteries: 2,
    batteryDrain: 0.55,
    lives: 3,
    stalkers: 1,
    lightScale: 0.8,
    blackout: false,
    fog: 0.095,
    creakZones: 5,
    stalker: {
      patrol: 1.7, investigate: 2.5, chase: 3.7, hearing: 1.15, visionLit: 12.5, visionDark: 6.5,
      awareness: 1.1, loseTime: 6, searchTime: 3.5, senseInterval: 0,
    },
  },
  {
    id: 3,
    name: 'Blackout',
    tagline: 'The fuses are gone. Your flashlight is all you have.',
    hint: 'Find 4 keys in the dark. Batteries drain faster.',
    areas: ['hall', 'east', 'north', 'west', 'crypt'],
    keys: 4,
    batteries: 3,
    batteryDrain: 0.7,
    lives: 3,
    stalkers: 1,
    lightScale: 0.9,
    blackout: true,
    fog: 0.105,
    creakZones: 6,
    stalker: {
      patrol: 1.8, investigate: 2.7, chase: 3.9, hearing: 1.3, visionLit: 14, visionDark: 7.5,
      awareness: 1.25, loseTime: 7, searchTime: 4, senseInterval: 0,
    },
  },
  {
    id: 4,
    name: 'The Hunt',
    tagline: 'She no longer waits for you to make a mistake.',
    hint: 'Find 5 keys. She can sense where you are.',
    areas: ['hall', 'east', 'north', 'west', 'crypt'],
    keys: 5,
    batteries: 3,
    batteryDrain: 0.75,
    lives: 3,
    stalkers: 1,
    lightScale: 0.6,
    blackout: false,
    fog: 0.11,
    creakZones: 7,
    stalker: {
      patrol: 2.0, investigate: 3.0, chase: 4.15, hearing: 1.45, visionLit: 15, visionDark: 8,
      awareness: 1.5, loseTime: 8, searchTime: 4.5, senseInterval: 40,
    },
  },
  {
    id: 5,
    name: 'No Way Out',
    tagline: 'She was never alone down here.',
    hint: 'Find 5 keys. There are two of them. You have two chances.',
    areas: ['hall', 'east', 'north', 'west', 'crypt'],
    keys: 5,
    batteries: 3,
    batteryDrain: 0.8,
    lives: 2,
    stalkers: 2,
    lightScale: 0.45,
    blackout: false,
    fog: 0.115,
    creakZones: 9,
    stalker: {
      patrol: 2.0, investigate: 3.0, chase: 4.25, hearing: 1.5, visionLit: 15, visionDark: 8,
      awareness: 1.7, loseTime: 9, searchTime: 5, senseInterval: 55,
    },
  },
];
