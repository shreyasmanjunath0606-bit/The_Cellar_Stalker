export class Inventory {
  keys = 0;
  batteries = 0;

  constructor(readonly keysRequired: number) {}

  get hasAllKeys(): boolean {
    return this.keys >= this.keysRequired;
  }
}
