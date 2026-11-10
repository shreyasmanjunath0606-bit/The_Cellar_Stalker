export enum GameState {
  Menu,
  /** Level loaded, waiting for the player to click in. */
  Intro,
  Playing,
  Paused,
  /** Caught, but with lives left. */
  Caught,
  GameOver,
  LevelComplete,
  Victory,
}

type Listener = (next: GameState, prev: GameState) => void;

export class StateManager {
  private state = GameState.Menu;
  private listeners: Listener[] = [];

  get current(): GameState {
    return this.state;
  }

  is(...states: GameState[]): boolean {
    return states.includes(this.state);
  }

  set(next: GameState): void {
    if (next === this.state) return;
    const prev = this.state;
    this.state = next;
    for (const l of this.listeners) l(next, prev);
  }

  onChange(listener: Listener): void {
    this.listeners.push(listener);
  }
}
