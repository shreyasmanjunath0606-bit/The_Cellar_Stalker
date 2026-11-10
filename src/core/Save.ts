export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  /** Mouse sensitivity multiplier, 0.3..2.5. */
  sensitivity: number;
  /** Master volume, 0..1. */
  volume: number;
  quality: Quality;
}

export interface Progress {
  /** Highest night the player may start. */
  unlocked: number;
  /** Best escape time in seconds, per night id. */
  best: Record<number, number>;
  /** All nights survived at least once. */
  finished: boolean;
}

const SETTINGS_KEY = 'cellar-stalker.settings.v1';
const PROGRESS_KEY = 'cellar-stalker.progress.v1';

const DEFAULT_SETTINGS: Settings = { sensitivity: 1, volume: 0.8, quality: 'high' };
const DEFAULT_PROGRESS: Progress = { unlocked: 1, best: {}, finished: false };

function read<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return structuredClone(fallback);
    return { ...structuredClone(fallback), ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return structuredClone(fallback); // private mode, blocked storage or corrupt data
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: progress simply does not persist */
  }
}

export const Save = {
  loadSettings(): Settings {
    const s = read(SETTINGS_KEY, DEFAULT_SETTINGS);
    s.sensitivity = Math.min(2.5, Math.max(0.3, Number(s.sensitivity) || 1));
    s.volume = Math.min(1, Math.max(0, Number(s.volume)));
    if (!['low', 'medium', 'high'].includes(s.quality)) s.quality = 'high';
    return s;
  },
  saveSettings(s: Settings): void {
    write(SETTINGS_KEY, s);
  },
  loadProgress(maxLevel: number): Progress {
    const p = read(PROGRESS_KEY, DEFAULT_PROGRESS);
    p.unlocked = Math.min(maxLevel, Math.max(1, Math.floor(Number(p.unlocked) || 1)));
    if (typeof p.best !== 'object' || p.best === null) p.best = {};
    return p;
  },
  saveProgress(p: Progress): void {
    write(PROGRESS_KEY, p);
  },
};
