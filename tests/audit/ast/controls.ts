import type { AuditCase } from './model.js';
import type { Language } from '../../../services/code-review/internal/ast/schema.js';

const inputs: [Language, string, string, 'function' | 'method', string][] = [
  ['js-ts', 'sample.ts', 'function named(value: string): string { return value; }', 'function', 'named'],
  ['python', 'sample.py', 'def named(value: int) -> int:\n    return value\n', 'function', 'named'],
  ['java', 'Box.java', 'class Box { int named(int value) { return value; } }', 'method', 'named'],
  ['go', 'sample.go', 'package sample\ntype Reader interface { Read(value int) int }', 'method', 'Read'],
  ['rust', 'sample.rs', 'fn named(value: i32) -> i32 { value }', 'function', 'named'],
];
export const controls: AuditCase[] = inputs.map(([backend, file, source, type, name]) => ({
  id: `CONTROL-${backend}`, title: `${backend} 已实现声明`, backend, scope: 'baseline', requirement: 'AST-F03 / 环境对照',
  files: { [file]: source }, entry: [file], expects: [{ kind: 'facts', file, selector: { type, name }, min: 1 }],
  implementation: [],
}));
export const planned: AuditCase[] = inputs.map(([backend, file, source]) => ({
  id: `SEMANTICS-${backend}`, title: `${backend} 类型与符号能力`, backend, scope: 'planned', requirement: '进一步接入的能力',
  files: { [file]: source }, entry: [file], params: { capabilities: ['syntax', 'structure', 'symbols', 'types'] },
  expects: [{ kind: 'executed', capability: 'symbols' }, { kind: 'executed', capability: 'types' }],
  implementation: ['services/code-review/ast/server.ts', 'services/code-review/ast/native-parsers.ts'],
}));
