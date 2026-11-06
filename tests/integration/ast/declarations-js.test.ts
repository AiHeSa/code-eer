import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { analyze, withFiles } from './helpers.js';
import { assertInventory, type ExpectedFact } from './expectations.js';

const service = new AstService();
after(() => service.close());
const source = `import type { Readable as Input } from 'stream';
export const worker = async (value: string): Promise<string> => value;
export let count = 1, ready = true;
export interface Reader { read(value: string): number; }
class Box<T> {
  constructor(public value: T) {}
  get current(): T { return this.value; }
  set current(next: T) { this.value = next; }
  async load(input: Input): Promise<T> { return this.value; }
}
export { Box as Store };
export * from './other.js';
`;
const expected: ExpectedFact[] = [
  { key: 'import', type: 'import', name: "'stream'", text: "import type { Readable as Input } from 'stream';", data: { clause: 'type { Readable as Input }' } },
  { key: 'worker', type: 'binding', name: 'worker', text: 'worker = async (value: string): Promise<string> => value' },
  { key: 'workerExport', type: 'export', name: 'worker', text: 'worker = async (value: string): Promise<string> => value' },
  { key: 'arrow', type: 'function', name: 'worker', parent: 'worker', text: 'async (value: string): Promise<string> => value',
    parameters: ['value: string'], returns: ['Promise<string>'], async: true, body: 'value', occurrence: 0 },
  { key: 'count', type: 'binding', name: 'count', text: 'count = 1' },
  { key: 'countExport', type: 'export', name: 'count', text: 'count = 1' },
  { key: 'ready', type: 'binding', name: 'ready', text: 'ready = true' },
  { key: 'readyExport', type: 'export', name: 'ready', text: 'ready = true' },
  { key: 'reader', type: 'type', name: 'Reader', text: 'export interface Reader { read(value: string): number; }' },
  { key: 'readerExport', type: 'export', name: 'Reader', text: 'export interface Reader { read(value: string): number; }' },
  { key: 'read', type: 'method', name: 'read', parent: 'reader', text: 'read(value: string): number;', parameters: ['value: string'], returns: ['number'], body: null },
  { key: 'box', type: 'type', name: 'Box', text: source.slice(source.indexOf('class Box'), source.indexOf('\nexport {')) },
  { key: 'constructor', type: 'constructor', name: 'constructor', parent: 'box', text: 'constructor(public value: T) {}', parameters: ['public value: T'], body: '{}' },
  { key: 'get', type: 'method', name: 'current', parent: 'box', text: 'get current(): T { return this.value; }', returns: ['T'], body: '{ return this.value; }' },
  { key: 'set', type: 'method', name: 'current', parent: 'box', text: 'set current(next: T) { this.value = next; }', parameters: ['next: T'], body: '{ this.value = next; }' },
  { key: 'load', type: 'method', name: 'load', parent: 'box', text: 'async load(input: Input): Promise<T> { return this.value; }',
    parameters: ['input: Input'], returns: ['Promise<T>'], async: true, body: '{ return this.value; }' },
  { key: 'exportList', type: 'export', name: '{ Box as Store }', text: 'export { Box as Store };' },
  { key: 'exportStar', type: 'export', name: "'./other.js'", text: "export * from './other.js';" },
];
test('JS/TS complete declaration inventory, signatures, parents and source spans', async () => {
  await withFiles({ 'sample.ts': source }, async (root) => {
    const result = await analyze(service, 'js-ts', ['sample.ts'], { root });
    assert.equal(result.status, 'complete');
    assertInventory(result.files[0]!, source, expected);
  });
});
test('TypeScript namespace, aliases, enums, call signatures and construct signatures', async () => {
  const source = 'namespace API { export type Value = string; export enum Mode { Ready } export interface Factory { (value: Value): Value; new(value: Value): Box; } }';
  const alias = 'export type Value = string;';
  const enumeration = 'export enum Mode { Ready }';
  const factory = 'export interface Factory { (value: Value): Value; new(value: Value): Box; }';
  await withFiles({ 'types.ts': source }, async (root) => {
    const result = await analyze(service, 'js-ts', ['types.ts'], { root });
    assertInventory(result.files[0]!, source, [
      { key: 'module', type: 'module', name: 'API', text: source },
      { key: 'alias', type: 'type', name: 'Value', parent: 'module', text: alias },
      { key: 'aliasExport', type: 'export', name: 'Value', parent: 'module', text: alias },
      { key: 'enum', type: 'type', name: 'Mode', parent: 'module', text: enumeration },
      { key: 'enumExport', type: 'export', name: 'Mode', parent: 'module', text: enumeration },
      { key: 'factory', type: 'type', name: 'Factory', parent: 'module', text: factory },
      { key: 'factoryExport', type: 'export', name: 'Factory', parent: 'module', text: factory },
      { key: 'call', type: 'function', name: null, parent: 'factory', text: '(value: Value): Value;', parameters: ['value: Value'], returns: ['Value'], body: null },
      { key: 'construct', type: 'constructor', name: 'new', parent: 'factory', text: 'new(value: Value): Box;', parameters: ['value: Value'], returns: ['Box'], body: null },
    ]);
  });
});
