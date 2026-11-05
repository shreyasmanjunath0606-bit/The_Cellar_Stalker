export class Inventory {
  readonly keysRequired = 3;
  keys = 0;
  batteries = 0;

  get hasAllKeys(): boolean {
    return this.keys >= this.keysRequired;
  }
}
