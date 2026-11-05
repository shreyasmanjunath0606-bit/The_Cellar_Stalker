export class Stamina {
  value = 100;
  private exhausted = false;

  get canSprint(): boolean {
    return !this.exhausted && this.value > 0;
  }

  update(dt: number, sprinting: boolean): void {
    if (sprinting) {
      this.value = Math.max(0, this.value - 22 * dt);
      if (this.value === 0) this.exhausted = true;
    } else {
      this.value = Math.min(100, this.value + 14 * dt);
      if (this.exhausted && this.value > 30) this.exhausted = false;
    }
  }
}
