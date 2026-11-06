import * as ts from 'typescript/ast';
import { bindingNames } from '../../ast/js-ts/scope.js';
import { callableName } from '../../ast/js-ts/declaration-name.js';
import { isExported } from '../../ast/js-ts/exports.js';
import type { Declaration } from './model.js';
import { isFunction, isImmediate, isLoop, location, text, type ScriptContext, type WalkContext } from './context.js';

function hoistedScope(context: ScriptContext, id: string): string {
  const scope = context.output.scopes.find((item) => item.id === id)!;
  return ['function', 'module', 'global', 'static-block'].includes(scope.kind) || !scope.parentId ? id : hoistedScope(context, scope.parentId);
}

function declare(context: ScriptContext, name: ts.Identifier, node: ts.Node, state: WalkContext,
  kind: Declaration['kind'], initializer: ts.Node | undefined, scopeId = state.scopeId): string {
  const exported = isExported(node) || ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)
    && ts.isVariableStatement(node.parent.parent) && isExported(node.parent.parent);
  const item = { ...location(context, name, 'binding'), name: name.text, scopeId,
    functionId: state.functionId, kind, initializer: text(context, initializer), exported };
  context.names.add(name); context.bindings.set(name, item.id); context.output.declarations.push(item);
  return item.id;
}

function variables(context: ScriptContext, node: ts.Node, state: WalkContext): void {
  if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name))
    declare(context, node.name, node, state, 'member', node.initializer);
  if (!ts.isVariableDeclaration(node) && !ts.isParameterDeclaration(node)) return;
  const list = node.parent;
  const kind = ts.isParameterDeclaration(node) ? 'parameter' : ts.isCatchClause(list) ? 'catch'
    : ts.isVariableDeclarationList(list) ? list.flags & ts.NodeFlags.Const ? 'const'
      : list.flags & ts.NodeFlags.Let ? 'let' : 'var' : 'unknown';
  const scopeId = kind === 'var' ? hoistedScope(context, state.scopeId) : state.scopeId;
  for (const name of bindingNames(node.name)) declare(context, name, node, state, kind, node.initializer, scopeId);
}

function imports(context: ScriptContext, node: ts.Node, state: WalkContext): void {
  const typeOnly = (value: ts.Node): boolean => ts.isImportClause(value) && value.phaseModifier === ts.SyntaxKind.TypeKeyword;
  if (ts.isImportClause(node) && node.name && !typeOnly(node))
    declare(context, node.name, node, state, 'import', undefined);
  if ((ts.isImportSpecifier(node) && !node.isTypeOnly && !typeOnly(node.parent.parent))
    || ts.isNamespaceImport(node) && !typeOnly(node.parent) || ts.isImportEqualsDeclaration(node) && !node.isTypeOnly)
    declare(context, node.name, node, state, 'import', undefined);
}

function namedDeclaration(context: ScriptContext, node: ts.Node, state: WalkContext): string | null {
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node)
    || ts.isClassExpression(node) || ts.isEnumDeclaration(node)) && node.name) {
    const scope = ts.isFunctionExpression(node) || ts.isClassExpression(node) ? location(context, node, 'scope').id : state.scopeId;
    return declare(context, node.name, node, state, isFunction(node) ? 'function' : 'class', undefined, scope);
  }
  return null;
}

function enter(context: ScriptContext, node: ts.Node, state: WalkContext): WalkContext {
  const bindingId = namedDeclaration(context, node, state);
  const callable = isFunction(node);
  const scopeKind = callable ? 'function' : ts.isClassStaticBlockDeclaration(node) ? 'static-block'
    : ts.isClassDeclaration(node) || ts.isClassExpression(node) ? 'class'
    : ts.isBlock(node) || ts.isCatchClause(node) || isLoop(node) || ts.isCaseBlock(node) || ts.isModuleBlock(node) ? 'block' : null;
  const scopeId = scopeKind ? location(context, node, 'scope').id : state.scopeId;
  if (scopeKind) context.output.scopes.push({ ...location(context, node, 'scope'), parentId: state.scopeId, kind: scopeKind });
  if (!callable) return { ...state, scopeId, dynamicScope: state.dynamicScope || ts.isWithStatement(node) };
  const id = location(context, node, 'function').id;
  if (bindingId) context.functionTargets.set(bindingId, id);
  if (bindingId && ts.isFunctionExpression(node))
    context.output.declarations.find((item) => item.id === bindingId)!.functionId = id;
  context.functionNodes.set(node, id);
  context.output.functions.push({ ...location(context, node, 'function'), name: callableName(node, context.file), scopeId,
    parentFunctionId: state.functionId, bindingId, async: Boolean(node.modifierFlags & ts.ModifierFlags.Async),
    generator: Boolean(node.asteriskToken), immediate: isImmediate(node), hasBody: Boolean(node.body) });
  return { scopeId, functionId: id, loops: [], dynamicScope: false };
}

export function collectDeclarations(context: ScriptContext): void {
  const root = location(context, context.file, 'scope');
  context.output.scopes.push({ ...root, parentId: null, kind: context.prefix || ts.isExternalModule(context.file) ? 'module' : 'global' });
  const walk = (node: ts.Node, state: WalkContext): void => {
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;
    const next = enter(context, node, state);
    context.locations.set(node, next);
    variables(context, node, next); imports(context, node, next);
    const child = isLoop(node) ? { ...next, loops: [...next.loops, location(context, node, 'loop').id] } : next;
    node.forEachChild((value) => {
      const once = ts.isForStatement(node) && value === node.initializer
        || (ts.isForOfStatement(node) || ts.isForInStatement(node)) && value === node.expression;
      walk(value, once ? next : child);
    });
  };
  walk(context.file, { scopeId: root.id, functionId: null, loops: [], dynamicScope: false });
  for (const [node, id] of context.functionNodes) {
    let value = node;
    while (ts.isParenthesizedExpression(value.parent) || ts.isAsExpression(value.parent)
      || ts.isSatisfiesExpression(value.parent) || ts.isNonNullExpression(value.parent)) value = value.parent;
    if (!ts.isVariableDeclaration(value.parent) || !ts.isIdentifier(value.parent.name)) continue;
    const item = context.output.functions.find((value) => value.id === id)!;
    item.bindingId = context.bindings.get(value.parent.name) ?? item.bindingId;
    if (item.bindingId) context.functionTargets.set(item.bindingId, id);
  }
}
