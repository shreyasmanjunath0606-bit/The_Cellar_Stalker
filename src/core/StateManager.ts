export enum GameState {
  Menu,
  Playing,
  Paused,
  Caught,
  Escaped,
}

type Listener = (next: GameState, prev: GameState) => void;

export class StateManager {
  private state = GameState.Menu;
  private listeners: Listener[] = [];

  get current(): GameState {
    return this.state;
  }

  is(state: GameState): boolean {
    return this.state === state;
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
