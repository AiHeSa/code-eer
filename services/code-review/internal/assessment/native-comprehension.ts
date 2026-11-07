import { named, children, descendants, type SyntaxNode } from '../ast/tree-runtime.js';
import { child } from './native-profile.js';
import { located, nativeId, type NativeContext } from './native-context.js';

export function comprehension(context: NativeContext, node: SyntaxNode, loops: string[], owner: string | null,
  outer: { loops: string[]; owner: string | null }, visit: (node: SyntaxNode, loops: string[], owner: string | null) => void): boolean {
  if (context.language !== 'python' || !['list_comprehension', 'set_comprehension', 'dictionary_comprehension', 'generator_expression'].includes(node.type)) return false;
  const clauses = named(node).filter((item) => item.type === 'for_in_clause'), ids = clauses.map((item) => nativeId(item, 'loop'));
  for (const [index, clause] of clauses.entries()) context.output.loops.push({ ...located(context, clause, 'loop'), functionId: owner,
    parentLoopId: index ? ids[index - 1]! : loops.at(-1) ?? null, kind: 'comprehension_for', initializer: null, condition: null,
    update: null, iterable: child(clause, 'right')?.text ?? null, depth: loops.length + index + 1 });
  for (const value of named(node)) {
    const index = clauses.findIndex((clause) => clause.id === value.id);
    if (index >= 0) for (const element of named(value)) {
      const eager = node.type === 'generator_expression' && index === 0 && element.id === child(value, 'right')?.id;
      visit(element, eager ? outer.loops : [...loops, ...ids.slice(0, index)], eager ? outer.owner : owner);
    }
    else {
      const active = value.type === 'if_clause' ? clauses.filter((clause) => clause.startIndex < value.startIndex).length : ids.length;
      visit(value, [...loops, ...ids.slice(0, active)], owner);
    }
  }
  return true;
}
