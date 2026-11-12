export type ItemType =
  | 'key' | 'hammer' | 'cutters'
  | 'carkey' | 'fuel' | 'carbattery' | 'crank'
  | 'balconykey' | 'ladderA' | 'ladderB' | 'rope'
  | 'crossbow' | 'dart' | 'battery';

export const ITEM_NAMES: Record<ItemType, string> = {
  key: 'door key',
  hammer: 'claw hammer',
  cutters: 'bolt cutters',
  carkey: 'car key',
  fuel: 'fuel can',
  carbattery: 'car battery',
  crank: 'winch crank',
  balconykey: 'balcony key',
  ladderA: 'ladder section',
  ladderB: 'ladder section',
  rope: 'coil of rope',
  crossbow: 'dart crossbow',
  dart: 'sleeping dart',
  battery: 'battery',
};

/** Everything the team has found. In co-op the whole team shares one pool. */
export class Inventory {
  private readonly counts = new Map<ItemType, number>();

  count(type: ItemType): number {
    return this.counts.get(type) ?? 0;
  }

  has(type: ItemType, n = 1): boolean {
    return this.count(type) >= n;
  }

  add(type: ItemType, n = 1): void {
    this.counts.set(type, this.count(type) + n);
  }

  /** Uses up `n` of an item. */
  take(type: ItemType, n = 1): void {
    this.counts.set(type, Math.max(0, this.count(type) - n));
  }

  /** Items in hand, for the HUD. */
  list(): [ItemType, number][] {
    return [...this.counts.entries()].filter(([t, n]) => n > 0 && t !== 'battery');
  }
}
