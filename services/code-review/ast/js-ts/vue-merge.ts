import type { RawNode, RawResult } from '../../internal/ast/raw.js';

export function mergeScript(target: RawResult, script: RawResult, parent: string, offset: number): void {
  const prefix = `${parent}:`;
  const shift = (value: number | null) => value === null ? null : value + offset;
  for (const node of script.nodes) target.nodes.push({ ...node, id: prefix + node.id,
    parent: node.parent === null ? parent : prefix + node.parent,
    data: { ...node.data, ...(typeof node.data['declarationId'] === 'string'
      ? { declarationId: prefix + node.data['declarationId'] } : {}) },
    start: shift(node.start), end: shift(node.end), bodyStart: shift(node.bodyStart), bodyEnd: shift(node.bodyEnd) });
  target.diagnostics.push(...script.diagnostics.map((item) => ({ ...item, start: shift(item.start), end: shift(item.end) })));
  target.skipped.push(...script.skipped);
  if (script.syntax) target.syntax = script.syntax;
  target.structureComplete &&= script.structureComplete;
}

export function vueNode(id: string, type: RawNode['type'], nativeType: string, name: string,
  start: number, end: number, parent: string | null, data: RawNode['data'] = {}): RawNode {
  return { id, type, nativeType, name, start, end, parent, data, parameters: [], returns: [], async: false,
    bodyStart: null, bodyEnd: null, role: 'block' };
}
