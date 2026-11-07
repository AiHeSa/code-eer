import { API } from 'typescript/async';
import * as ts from 'typescript/ast';
import { scriptContext, location, unwrap, type ScriptContext } from '../assessment/context.js';
import { collectDeclarations } from '../assessment/declarations.js';
import { createScopeResolver } from '../../ast/js-ts/scope.js';
import { deriveCost, type CostSummary } from './cost.js';
import { expression } from './cost-expressions.js';
import { deriveModuleCost } from './module-cost.js';
import type { Range } from '../ast/schema.js';
import { collectSemanticLinks, emptyLinks, type SemanticLinks } from './semantic-links.js';
import { localPurity } from './effect-analysis.js';
import type { Proof } from './model.js';
import { semanticScripts } from './semantic-scripts.js';
import type { NativeFunctionModel } from './native-model.js';

export interface Dependency { id: string; range: Range; source: string | null; targetPath?: string; verifiedExternal?: boolean }
export interface Semantics { costs: Map<string, CostSummary>; primitiveBindings: Set<string>; dependencies: Dependency[]; completeImports: boolean;
  imports: Map<string, { source: string; imported: string }>; exports: Map<string, string>; moduleCost: CostSummary | null;
  parameterCounts: Map<string, number>; links: SemanticLinks; localPure: Set<string>; purity: Map<string, Proof>; exportsComplete: boolean;
  nativeModels: Map<string, NativeFunctionModel> | null }

function imports(context: ScriptContext, result: Semantics, node: ts.ImportDeclaration): void {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return;
  const add = (name: ts.Identifier, imported: string) => {
    const id = context.bindings.get(name);
    if (id) result.imports.set(id, { source: (node.moduleSpecifier as ts.StringLiteral).text, imported });
  };
  if (node.importClause?.name) add(node.importClause.name, 'default');
  const bindings = node.importClause?.namedBindings;
  if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) add(item.name, (item.propertyName ?? item.name).text);
}

function exports(context: ScriptContext, result: Semantics, node: ts.Node): void {
  const target = (name: string) => {
    const binding = context.output.declarations.find((item) => item.name === name
      && context.output.scopes.find((scope) => scope.id === item.scopeId)?.parentId === null);
    return context.output.functions.find((item) => item.bindingId === binding?.id)?.id;
  };
  if (ts.isExportDeclaration(node) && !node.moduleSpecifier && !node.isTypeOnly && node.exportClause && ts.isNamedExports(node.exportClause))
    for (const item of node.exportClause.elements) {
      const id = target((item.propertyName ?? item.name).text);
      if (id && !item.isTypeOnly) result.exports.set(item.name.text, id);
    }
  if (ts.isExportAssignment(node) && !node.isExportEquals) {
    const value = unwrap(node.expression);
    const id = ts.isIdentifier(value) ? target(value.text) : context.functionNodes.get(value);
    if (id) result.exports.set('default', id);
  }
}

function dependencies(context: ScriptContext, result: Semantics, node: ts.Node, resolver: ReturnType<typeof createScopeResolver>): void {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    if (node.moduleSpecifier) result.dependencies.push({ ...location(context, node, 'dependency'),
      source: ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null });
    if (ts.isImportDeclaration(node)) imports(context, result, node);
  }
  if (ts.isImportEqualsDeclaration(node)) result.dependencies.push({ ...location(context, node, 'dependency'),
    source: ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression
      && ts.isStringLiteral(node.moduleReference.expression) ? node.moduleReference.expression.text : null });
  if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression)
    && node.expression.text === 'require' && !resolver.resolve(node.expression, 'require')))
    result.dependencies.push({ ...location(context, node, 'dependency'),
      source: node.arguments[0] && ts.isStringLiteral(node.arguments[0]) ? node.arguments[0].text : null });
  if (ts.isWithStatement(node) || ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'eval')
    result.completeImports = false;
}

function callables(context: ScriptContext, result: Semantics): void {
  for (const [node, id] of context.functionNodes) {
    const fn = node as ts.FunctionLikeDeclaration, cost = deriveCost(fn);
    if (localPurity(fn)) result.localPure.add(id);
    if (cost) result.costs.set(id, cost);
    result.parameterCounts.set(id, fn.parameters.length);
    if (ts.isSourceFile(node.parent) && fn.modifierFlags & ts.ModifierFlags.Export) result.exports.set(fn.modifierFlags & ts.ModifierFlags.Default ? 'default'
      : context.output.functions.find((item) => item.id === id)?.name ?? '', id);
  }
  for (const fn of context.output.functions) if (fn.bindingId) {
    const declaration = context.output.declarations.find((item) => item.id === fn.bindingId);
    if (declaration?.exported && context.output.scopes.find((scope) => scope.id === declaration.scopeId)?.parentId === null)
      result.exports.set(declaration.name, fn.id);
  }
}

export function emptySemantics(): Semantics {
  return { costs: new Map(), primitiveBindings: new Set(), dependencies: [], completeImports: true,
    imports: new Map(), exports: new Map(), moduleCost: null, parameterCounts: new Map(), links: emptyLinks(), localPure: new Set(), purity: new Map(), exportsComplete: true, nativeModels: null };
}

async function scriptSemantics(api: API, script: ReturnType<typeof semanticScripts>['scripts'][number], source: string): Promise<Semantics> {
  const result = emptySemantics();
  await using lease = await api.createSourceFile(script.path, script.source);
  const context = scriptContext(lease.sourceFile, source, script.offset, script.prefix);
  result.exportsComplete = ts.isExternalModule(lease.sourceFile);
  result.moduleCost = deriveModuleCost(lease.sourceFile);
  collectDeclarations(context); callables(context, result);
  result.links = collectSemanticLinks(context);
  const resolver = createScopeResolver(lease.sourceFile);
  const walk = (node: ts.Node): void => {
    if (ts.isExportAssignment(node) && node.isExportEquals) result.exportsComplete = false;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const constant = expression(node.initializer, new Map());
      if (constant && constant.value.kind !== 'unknown') result.primitiveBindings.add(location(context, node.name, 'binding').id);
    }
    dependencies(context, result, node, resolver); exports(context, result, node);
    node.forEachChild(walk);
  };
  walk(lease.sourceFile); return result;
}

function mergeSemantics(target: Semantics, part: Semantics): void {
  for (const key of ['costs', 'parameterCounts', 'imports', 'exports'] as const)
    for (const [id, value] of part[key]) (target[key] as Map<string, unknown>).set(id, value);
  for (const id of part.primitiveBindings) target.primitiveBindings.add(id);
  for (const id of part.localPure) target.localPure.add(id);
  target.dependencies.push(...part.dependencies); target.completeImports &&= part.completeImports; target.exportsComplete &&= part.exportsComplete;
  for (const key of ['aliases', 'calls', 'objects', 'namespaces', 'exportBindings'] as const)
    for (const [id, value] of part.links[key]) (target.links[key] as Map<string, unknown>).set(id, value);
  target.links.reexports.push(...part.links.reexports);
}

export async function deriveSemantics(path: string, source: string): Promise<Semantics> {
  const result = emptySemantics(), parts = semanticScripts(path, source);
  result.completeImports = parts.complete;
  result.exportsComplete = parts.complete && !path.endsWith('.vue');
  await using api = new API();
  const modules: CostSummary[] = [];
  for (const script of parts.scripts) {
    const part = await scriptSemantics(api, script, source); mergeSemantics(result, part);
    if (part.moduleCost) modules.push(part.moduleCost);
  }
  if (parts.complete && modules.length === parts.scripts.length) result.moduleCost = {
    time: modules.reduce((sum, item) => sum + item.time, 0), space: modules.reduce((sum, item) => sum + item.space, 0),
    pure: false, isolated: false, model: 'primitive-source-operations-v2; independent own script initializations; template execution excluded',
  };
  return result;
}
