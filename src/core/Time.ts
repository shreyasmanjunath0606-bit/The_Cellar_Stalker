const MAX_DELTA = 0.05;

export class GameTime {
  delta = 0;
  elapsed = 0;
  private last = 0;

  tick(nowMs: number): void {
    const now = nowMs / 1000;
    this.delta = this.last === 0 ? 0 : Math.min(now - this.last, MAX_DELTA);
    this.last = now;
    this.elapsed += this.delta;
  }
}
