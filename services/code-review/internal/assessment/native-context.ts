import { named, children, descendants, type SyntaxNode } from '../ast/tree-runtime.js';
import { emptyEvidence, type SyntaxEvidence, type Declaration, type CollectionInput } from './model.js';
import { sourceLocator } from '../ast/tree.js';
import { profiles, child, bindingNames, type NativeLanguage } from './native-profile.js';
import { importNames } from './native-imports.js';

export interface NativeState { scopeId: string; functionId: string | null }
export interface NativeContext { language: NativeLanguage; source: string; output: SyntaxEvidence;
  locate: ReturnType<typeof sourceLocator>; states: Map<number, NativeState>; names: Set<number>;
  targets: Map<string, string>; scopes: Map<string, string | null>; root: SyntaxNode; generators: Map<number, NativeState>;
  semantic: CollectionInput['file']['semantic'] }
type Directives = { global: Set<string>; nonlocal: Set<string> };
const directives = new WeakMap<NativeContext, Map<string, Directives>>();
const visibility = new WeakMap<NativeContext, Map<string, number>>();
export const nativeId = (node: SyntaxNode, kind: string) => `${kind}:${node.type}:${node.startIndex}:${node.endIndex}`;
export const located = (context: NativeContext, node: SyntaxNode, kind: string) => ({ id: nativeId(node, kind), range: context.locate(node.startIndex, node.endIndex) });

function exported(context: NativeContext, node: SyntaxNode, name: string, state: NativeState): boolean {
  if (context.language === 'python') return state.functionId === null;
  if (context.language === 'go') return /^\p{Lu}/u.test(name);
  if (context.language === 'rust') return named(node).some((item) => item.type === 'visibility_modifier');
  const declaration = node.type === 'variable_declarator' ? node.parent ?? node : node;
  return !named(declaration).some((item) => item.type === 'modifiers' && children(item).some((token) => token.type === 'private'));
}

function declare(context: NativeContext, name: SyntaxNode, node: SyntaxNode, state: NativeState, kind: Declaration['kind'], label = name.text): string {
  const destination = bindingScope(context, label, state, kind), outside = destination.scopeId !== state.scopeId;
  state = destination;
  const existing = context.output.declarations.find((item) => item.scopeId === state.scopeId && item.name === label);
  if (existing?.id === nativeId(name, 'binding')) { if (!outside) context.names.add(name.id); return existing.id; }
  if (existing && (context.language === 'python' || context.language === 'go') && kind === 'let') return existing.id;
  if (!outside) context.names.add(name.id);
  const item = { ...located(context, name, 'binding'), name: label, scopeId: state.scopeId, functionId: state.functionId,
    kind, initializer: child(node, 'value', 'right')?.text ?? null, exported: exported(context, node, label, state), storage: storage(context, node, state, kind) };
  context.output.declarations.push(item);
  const after = node.type === 'for_expression' ? child(node, 'value')?.endIndex ?? name.endIndex : node.endIndex;
  visibility.get(context)!.set(item.id, ['go', 'rust'].includes(context.language) && state.functionId
    && !['function', 'class', 'parameter', 'member', 'import'].includes(kind) && !['const_item', 'static_item'].includes(node.type) ? after : 0);
  return item.id;
}

function storage(context: NativeContext, node: SyntaxNode, state: NativeState, kind: Declaration['kind']): 'global' | 'instance' | 'local' {
  const scope = context.output.scopes.find((scope) => scope.id === state.scopeId);
  if (node.type === 'static_item' || scope?.kind === 'module') return 'global';
  if (scope?.kind !== 'class') return 'local';
  if (context.language === 'python' || context.language === 'rust' && node.type === 'const_item') return 'global';
  const declaration = node.type === 'variable_declarator' ? node.parent ?? node : node;
  return named(declaration).some((item) => item.type === 'modifiers' && children(item).some((token) => token.type === 'static')) ? 'global' : 'instance';
}

function bindingScope(context: NativeContext, name: string, state: NativeState, kind: Declaration['kind']): NativeState {
  if (context.language !== 'python' || !state.functionId || kind === 'parameter') return state;
  const names = directives.get(context)?.get(state.functionId);
  if (names?.global.has(name)) return { scopeId: 'scope:module', functionId: null };
  if (!names?.nonlocal.has(name)) return state;
  const fn = context.output.functions.find((fn) => fn.id === state.functionId);
  let parent = context.scopes.get(fn!.scopeId);
  while (parent) {
    const owner = context.output.functions.find((fn) => fn.scopeId === parent);
    if (owner) return { scopeId: parent, functionId: owner.id };
    parent = context.scopes.get(parent);
  }
  return state;
}

function pythonDirectives(context: NativeContext, node: SyntaxNode, id: string): void {
  if (context.language !== 'python') return;
  const result: Directives = { global: new Set(), nonlocal: new Set() };
  const walk = (value: SyntaxNode): void => {
    if (value.id !== node.id && profiles.python.functions.includes(value.type)) return;
    if (value.type === 'global_statement' || value.type === 'nonlocal_statement')
      for (const name of named(value).filter((item) => item.type === 'identifier')) result[value.type === 'global_statement' ? 'global' : 'nonlocal'].add(name.text);
    for (const child of named(value)) walk(child);
  };
  walk(node); directives.get(context)!.set(id, result);
}

function enter(context: NativeContext, node: SyntaxNode, state: NativeState): NativeState {
  const profile = profiles[context.language], callable = profile.functions.includes(node.type), type = profile.classes.includes(node.type);
  let name = child(node, 'name'), bindingId: string | null = null;
  if (callable && !name && node.parent && node.type !== 'generator_expression') name = child(node.parent, 'name', 'pattern', 'left');
  if (name?.type === 'expression_list' && name.namedChildCount === 1) name = named(name)[0]!;
  if (name && ['identifier', 'field_identifier', 'type_identifier'].includes(name.type) && (callable || type)) bindingId = declare(context, name, node, state,
    callable ? context.output.scopes.find((scope) => scope.id === state.scopeId)?.kind === 'class' ? 'member' : 'function' : 'class');
  if (!callable && !type && !profile.blocks.includes(node.type)) return state;
  const scopeId = nativeId(node, 'scope'); context.scopes.set(scopeId, state.scopeId);
  context.output.scopes.push({ ...located(context, node, 'scope'), parentId: state.scopeId, kind: callable ? 'function' : type ? 'class' : 'block' });
  if (!callable) return { ...state, scopeId };
  const id = nativeId(node, 'function'); if (bindingId) context.targets.set(bindingId, id);
  pythonDirectives(context, node, id);
  let value = node;
  while (value.parent?.type === 'parenthesized_expression') value = value.parent;
  const immediate = Boolean(value.parent && profile.calls.includes(value.parent.type) && child(value.parent, 'function')?.id === value.id);
  context.output.functions.push({ ...located(context, node, 'function'), name: name?.text ?? null, scopeId, bindingId,
    parentFunctionId: state.functionId, async: named(node).some((item) => item.type === 'async') || node.text.startsWith('async '),
    generator: node.type === 'generator_expression' || context.language === 'python' && ownYield(context, node), immediate,
    hasBody: Boolean(child(node, 'body') ?? named(node).find((item) => item.type === 'block')), dispatch: dispatch(context, node) });
  return { scopeId, functionId: id };
}

function ownYield(context: NativeContext, node: SyntaxNode): boolean {
  const scan = (value: SyntaxNode): boolean => {
    if (['yield', 'yield_expression', 'yield_statement'].includes(value.type)) return true;
    if (value.id !== node.id && profiles.python.functions.includes(value.type)) return false;
    return named(value).some(scan);
  };
  return scan(node);
}

function dispatch(context: NativeContext, node: SyntaxNode): 'direct' | 'virtual' {
  if (context.language === 'java' && node.type === 'method_declaration') {
    const modifiers = named(node).find((item) => item.type === 'modifiers');
    return children(modifiers).some((item) => ['static', 'private', 'final'].includes(item.type)) ? 'direct' : 'virtual';
  }
  if (context.language === 'rust') {
    let parent = node.parent;
    while (parent) { if (parent.type === 'trait_item') return 'virtual'; if (profiles.rust.functions.includes(parent.type)) break; parent = parent.parent; }
  }
  return context.language === 'python' && node.parent?.parent?.type === 'class_definition' ? 'virtual' : 'direct';
}

function variables(context: NativeContext, node: SyntaxNode, state: NativeState): void {
  const profile = profiles[context.language], parameter = profile.parameters.includes(node.type);
  if (!parameter && !profile.variables.includes(node.type)) return;
  for (const name of bindingNames(context.language, node, parameter)) {
    const member = context.output.scopes.find((scope) => scope.id === state.scopeId)?.kind === 'class';
    const kind = parameter ? 'parameter' : member ? 'member' : node.type === 'const_spec' || node.type === 'const_item'
      || context.language === 'rust' && !named(node).some((item) => item.type === 'mutable_specifier') ? 'const' : 'let';
    declare(context, name, node, state, kind);
  }
}

export function nativeContext(input: CollectionInput, language: NativeLanguage, root: SyntaxNode): NativeContext {
  const output = emptyEvidence(), scopeId = 'scope:module';
  const context: NativeContext = { language, root, source: input.source, output, locate: sourceLocator(input.source),
    states: new Map(), names: new Set(), targets: new Map(), scopes: new Map([[scopeId, null]]), generators: new Map(), semantic: input.file.semantic };
  directives.set(context, new Map()); visibility.set(context, new Map());
  output.scopes.push({ id: scopeId, parentId: null, kind: 'module', range: context.locate(0, input.source.length) });
  const walk = (node: SyntaxNode, state: NativeState): void => {
    const next = enter(context, node, state); context.states.set(node.id, next); variables(context, node, next);
    if (profiles[language].imports.includes(node.type)) for (const item of importNames(language, node, context.semantic?.imports)) declare(context, item.node, node, next, 'import', item.name);
    if (node.type === 'generator_expression') context.generators.set(node.id, state);
    for (const value of named(node)) {
      const first = node.parent?.type === 'generator_expression' && node.type === 'for_in_clause'
        && node.id === named(node.parent).find((item) => item.type === 'for_in_clause')?.id && value.id === child(node, 'right')?.id;
      walk(value, first ? context.generators.get(node.parent!.id)! : next);
    }
  };
  walk(root, { scopeId, functionId: null }); return context;
}

export function resolveBinding(context: NativeContext, name: string, state: NativeState, offset: number): Declaration | null {
  let scope: string | null = bindingScope(context, name, state, 'let').scopeId;
  while (scope) {
    const skipClass = context.language === 'python' && state.functionId && context.output.scopes.find((item) => item.id === scope)?.kind === 'class';
    const candidates = skipClass ? [] : context.output.declarations.filter((item) => item.scopeId === scope && item.name === name && (visibility.get(context)!.get(item.id) ?? 0) <= offset);
    if (candidates.length) return candidates.length === 1 ? candidates[0]! : context.language === 'rust' ? candidates.filter((item) => !['function', 'class'].includes(item.kind)).at(-1) ?? null : null;
    scope = context.scopes.get(scope) ?? null;
  }
  return null;
}
