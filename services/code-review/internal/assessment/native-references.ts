import { named, children, descendants, type SyntaxNode } from '../ast/tree-runtime.js';
import { fileURLToPath } from 'node:url';
import { identifierNodes } from '../ast/tree.js';
import { child, profiles } from './native-profile.js';
import { located, resolveBinding, type NativeContext } from './native-context.js';
import type { CollectionInput, Reference } from './model.js';

const contains = (outer: SyntaxNode, inner: SyntaxNode) => outer.startIndex <= inner.startIndex && outer.endIndex >= inner.endIndex;
function valueIdentifier(context: NativeContext, node: SyntaxNode): boolean {
  if (context.names.has(node.id) || !context.states.has(node.id)) return false;
  const parent = node.parent;
  if (!parent) return false;
  if (['global_statement', 'nonlocal_statement'].includes(parent.type)) return false;
  if (['attribute', 'selector_expression', 'field_expression', 'field_access', 'method_invocation'].includes(parent.type)
    && child(parent, 'attribute', 'field', 'name')?.id === node.id) return false;
  if (parent.type.includes('type') || ['package_clause', 'import_spec', 'scoped_identifier', 'use_declaration'].includes(parent.type)) return false;
  return true;
}
function access(node: SyntaxNode): Pick<Reference, 'access' | 'property'> {
  let value = node;
  while (value.parent && ['attribute', 'selector_expression', 'field_expression', 'field_access', 'subscript', 'index_expression', 'array_access'].includes(value.parent.type)
    && child(value.parent, 'object', 'value', 'operand', 'array')?.id === value.id) value = value.parent;
  const property = value.id === node.id ? null : value.text;
  while (value.parent && ['expression_list', 'pattern_list', 'tuple_pattern', 'list_pattern'].includes(value.parent.type)) value = value.parent;
  const parent = value.parent, left = parent ? child(parent, 'left', 'target', 'argument') : null;
  const write = Boolean(parent && (left && contains(left, value) && /assignment|declaration/.test(parent.type)
    || /update_expression|increment_statement|decrement_statement|inc_statement|dec_statement/.test(parent.type)));
  const compound = Boolean(parent && /augmented|compound|update|increment|decrement|inc_statement|dec_statement/.test(parent.type));
  return { access: write ? compound ? 'read-write' : 'write' : 'read', property };
}

export function nativeReferences(context: NativeContext, input: CollectionInput): void {
  const references = identifierNodes(context.root), semantic = input.file.semantic;
  for (const node of references) {
    if (!valueIdentifier(context, node)) continue;
    const state = context.states.get(node.id)!, range = context.locate(node.startIndex, node.endIndex);
    const resolved = semantic?.references.find((item) => item.range.start.line === range.start.line && item.range.start.character === range.start.character);
    const definition = resolved?.definition, local = definition?.uri === input.file.uri;
    const target = local ? context.output.declarations.find((item) => item.name === node.text
      && item.range.start.line >= definition.range.start.line && item.range.end.line <= definition.range.end.line
      && (item.range.start.line !== definition.range.start.line || item.range.start.character >= definition.range.start.character)
      && (item.range.end.line !== definition.range.end.line || item.range.end.character <= definition.range.end.character)) : null;
    const declaration = target ?? resolveBinding(context, node.text, state, node.startIndex);
    context.output.references.push({ ...located(context, node, 'reference'), functionId: state.functionId,
      scopeId: state.scopeId, name: node.text, targetId: declaration?.id ?? null, dynamicScope: false, ...access(node) });
  }
  const dynamic = context.language === 'python' && context.output.calls.some((call) => ['eval', 'exec', 'globals', 'locals', 'setattr'].includes(call.callee));
  if (dynamic) for (const ref of context.output.references) { ref.dynamicScope = true; ref.targetId = null; }
}

export function nativeCall(context: NativeContext, node: SyntaxNode, loops: string[]): void {
  const state = context.states.get(node.id)!;
  const callee = child(node, 'function', 'name', 'type', 'macro') ?? named(node)[0];
  if (!callee) return;
  const object = child(node, 'object'), name = object ? `${object.text}.${callee.text}` : callee.text;
  const binding = callee.type === 'identifier' && !object ? resolveBinding(context, callee.text, state, node.startIndex) : null;
  const rewritten = binding && context.output.references.some((ref) => ref.targetId === binding.id && ref.access !== 'read' && ref.property === null);
  let targetId = !rewritten && binding ? context.targets.get(binding.id) ?? null : null;
  if (binding?.kind === 'let' || binding?.kind === 'var') targetId = null;
  if (context.output.functions.find((fn) => fn.id === targetId)?.dispatch === 'virtual') targetId = null;
  const args = child(node, 'arguments');
  context.output.calls.push({ ...located(context, node, 'call'), functionId: state.functionId, callee: name,
    targetId, bindingId: binding?.id ?? null, resolution: targetId ? 'lexical' : 'unresolved', calleeRange: context.locate(object?.startIndex ?? callee.startIndex, callee.endIndex),
    arguments: named(args).map((item) => item.text) ?? [], kind: node.type.includes('creation') || node.type.includes('constructor') ? 'new' : 'call', loopIds: loops });
}
