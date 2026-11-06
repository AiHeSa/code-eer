import type { Item } from './types.js';
export interface Record { value: number }
export async function load(item: Item): Promise<number> {
  return item.value;
}
export class Store {
  constructor(public value: number) {}
  get(): number { return this.value; }
}
