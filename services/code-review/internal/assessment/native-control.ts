import { named, children, descendants, type SyntaxNode } from '../ast/tree-runtime.js';
import { profiles, child } from './native-profile.js';
import { located, nativeId, type NativeContext } from './native-context.js';
import { nativeCall } from './native-references.js';
import { comprehension } from './native-comprehension.js';

const exits: Record<string, 'return' | 'throw' | 'break' | 'continue' | 'await' | 'yield'> = {
  return_statement: 'return', return_expression: 'return', throw_statement: 'throw', raise_statement: 'throw',
  break_statement: 'break', break_expression: 'break', continue_statement: 'continue', continue_expression: 'continue',
  await: 'await', await_expression: 'await', yield: 'yield', yield_expression: 'yield', yield_statement: 'yield',
};
function effects(context: NativeContext, node: SyntaxNode, loops: string[], functionId: string | null): void {
  const kind = ['assignment', 'assignment_expression', 'assignment_statement', 'augmented_assignment', 'compound_assignment_expr', 'compound_assignment_expression'].includes(node.type)
    ? 'assignment' : /update_expression|increment_statement|decrement_statement|inc_statement|dec_statement/.test(node.type) ? 'update'
      : node.type === 'this' ? 'this' : node.type === 'super' ? 'super' : null;
  if (kind) {
    const target = child(node, 'left', 'argument', 'operand') ?? (kind === 'update' ? named(node)[0] : null);
    context.output.effects.push({ ...located(context, node, 'effect'), functionId, kind, expression: node.text,
      ...(target ? { targetRange: context.locate(target.startIndex, target.endIndex) } : {}) });
  }
  const allocation = ['list', 'list_comprehension', 'array_expression', 'array_creation_expression', 'array_initializer'].includes(node.type) ? 'array'
    : ['dictionary', 'dictionary_comprehension', 'set', 'set_comprehension', 'struct_expression', 'composite_literal'].includes(node.type) ? 'object'
      : node.type === 'object_creation_expression' ? 'new' : ['lambda', 'lambda_expression', 'closure_expression', 'func_literal', 'generator_expression'].includes(node.type) ? 'closure' : null;
  if (allocation) context.output.allocations.push({ ...located(context, node, 'allocation'), functionId, kind: allocation, expression: node.text, loopIds: loops });
}
export function nativeControl(context: NativeContext): void {
  const profile = profiles[context.language];
  const walk = (node: SyntaxNode, loops: string[], owner: string | null): void => {
    const outer = { loops, owner };
    const state = context.states.get(node.id)!;
    effects(context, node, loops, owner);
    if (state.functionId !== owner) { loops = []; owner = state.functionId; }
    if (comprehension(context, node, loops, owner, outer, walk)) return;
    if (profile.calls.includes(node.type)) nativeCall(context, node, loops);
    if (profile.branches.includes(node.type)) context.output.branches.push({ ...located(context, node, 'branch'), functionId: owner,
      kind: node.type, condition: child(node, 'condition', 'value')?.text ?? null });
    if (exits[node.type]) context.output.exits.push({ ...located(context, node, 'exit'), functionId: owner, kind: exits[node.type]!,
      value: child(node, 'value')?.text ?? named(node)[0]?.text ?? null, enclosingLoopId: loops.at(-1) ?? null });
    if (profile.loops.includes(node.type)) {
      const id = nativeId(node, 'loop'), clause = named(node).find((item) => item.type === 'for_clause' || item.type === 'range_clause');
      context.output.loops.push({ ...located(context, node, 'loop'), functionId: owner, parentLoopId: loops.at(-1) ?? null, kind: node.type,
        initializer: child(node, 'initializer')?.text ?? clause?.childForFieldName('initializer')?.text ?? null,
        condition: child(node, 'condition')?.text ?? clause?.childForFieldName('condition')?.text ?? null,
        update: child(node, 'update')?.text ?? clause?.childForFieldName('update')?.text ?? null,
        iterable: child(node, 'right', 'value')?.text ?? clause?.childForFieldName('right')?.text ?? null, depth: loops.length + 1 });
      for (const value of named(node)) walk(value, value.id === child(node, 'right', 'value', 'initializer')?.id ? loops : [...loops, id], owner);
    } else for (const value of named(node)) walk(value, loops, owner);
  };
  walk(context.root, [], null);
}
