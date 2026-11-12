import type { Difficulty } from './Levels';

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  /** Mouse sensitivity multiplier, 0.2..4. */
  sensitivity: number;
  /** Master volume, 0..1. */
  volume: number;
  quality: Quality;
  /** Lower the graphics automatically when the frame rate drops. */
  autoQuality: boolean;
  invertY: boolean;
  difficulty: Difficulty;
  /** Name shown to other players in co-op. */
  name: string;
}

export interface Progress {
  /** Highest night the player may start. */
  unlocked: number;
  /** Best escape time in seconds, keyed by `${night}-${difficulty}`. */
  best: Record<string, number>;
  /** All nights survived at least once. */
  finished: boolean;
}

const SETTINGS_KEY = 'cellar-stalker.settings.v2';
const PROGRESS_KEY = 'cellar-stalker.progress.v2';

const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1, volume: 0.8, quality: 'medium', autoQuality: true, invertY: false, difficulty: 'easy', name: '',
};
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

export const cleanName = (s: string): string => s.replace(/[^\w \-]/g, '').trim().slice(0, 14);

export const Save = {
  loadSettings(): Settings {
    const s = read(SETTINGS_KEY, DEFAULT_SETTINGS);
    s.sensitivity = Math.min(4, Math.max(0.2, Number(s.sensitivity) || 1));
    s.volume = Math.min(1, Math.max(0, Number(s.volume)));
    if (!['low', 'medium', 'high'].includes(s.quality)) s.quality = 'medium';
    if (!['easy', 'medium', 'hard'].includes(s.difficulty)) s.difficulty = 'easy';
    s.autoQuality = s.autoQuality !== false;
    s.invertY = s.invertY === true;
    s.name = cleanName(String(s.name ?? ''));
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
