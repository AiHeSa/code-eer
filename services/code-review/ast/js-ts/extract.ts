import * as ts from 'typescript/ast';
import type { RawNode } from '../../internal/ast/raw.js';
import { callableName } from './declaration-name.js';
import { createScopeResolver, type ScopeResolver } from './scope.js';
import { isExported } from './exports.js';
import { commonJs } from './commonjs.js';

export function describe(node: ts.Node, file: ts.SourceFile): { type: RawNode['type']; name: string | null } | undefined {
  const text = (value?: ts.Node) => value?.getText(file) ?? null;
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))
    return { type: 'function', name: callableName(node, file) };
  if (ts.isVariableDeclaration(node)) return { type: 'binding', name: text(node.name) };
  if (ts.isBindingElement(node) && node.name) return { type: 'binding', name: text(node.name) };
  if (ts.isMethodDeclaration(node) || ts.isMethodSignatureDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node))
    return { type: 'method', name: text(node.name) };
  if (ts.isConstructorDeclaration(node)) return { type: 'constructor', name: 'constructor' };
  if (ts.isCallSignatureDeclaration(node)) return { type: 'function', name: null };
  if (ts.isConstructSignatureDeclaration(node)) return { type: 'constructor', name: 'new' };
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) return { type: 'type', name: text(node.name) };
  if (ts.isModuleDeclaration(node)) return { type: 'module', name: text(node.name) };
  if (ts.isImportDeclaration(node)) return { type: 'import', name: text(node.moduleSpecifier) };
  if (ts.isImportEqualsDeclaration(node)) return { type: 'import', name: text(node.moduleReference) };
  if (ts.isExportDeclaration(node)) return { type: 'export', name: text(node.moduleSpecifier ?? node.exportClause) };
  if (ts.isExportAssignment(node)) return { type: 'export', name: text(node.expression) };
  if (ts.isJsxElement(node)) return { type: 'templateElement', name: text(node.openingElement.tagName) };
  if (ts.isJsxSelfClosingElement(node)) return { type: 'templateElement', name: text(node.tagName) };
  if (ts.isJsxFragment(node)) return { type: 'templateElement', name: '#fragment' };
  if (ts.isJsxAttribute(node)) return { type: 'attribute', name: text(node.name) };
  if (ts.isJsxSpreadAttribute(node)) return { type: 'attribute', name: null };
  if (ts.isJsxExpression(node)) return { type: 'binding', name: text(node.expression) };
  return undefined;
}

function populate(item: RawNode, node: ts.Node, file: ts.SourceFile): void {
  if (ts.isFunctionLikeDeclaration(node) || ts.isMethodSignatureDeclaration(node)
    || ts.isCallSignatureDeclaration(node) || ts.isConstructSignatureDeclaration(node)) {
    item.parameters = node.parameters.map((parameter) => parameter.getText(file));
    item.returns = node.type ? [node.type.getText(file)] : [];
    item.async = 'modifierFlags' in node && Boolean((node.modifierFlags as number) & ts.ModifierFlags.Async);
    if ('body' in node && node.body) {
      item.bodyStart = node.body.getStart(file); item.bodyEnd = node.body.end;
    }
  }
  if ('modifiers' in node && node.modifiers)
    item.data['modifiers'] = (node.modifiers as ts.NodeArray<ts.ModifierLike>).map((modifier) => modifier.getText(file));
  if ('typeParameters' in node && node.typeParameters)
    item.data['typeParameters'] = (node.typeParameters as ts.NodeArray<ts.Node>).map((value) => value.getText(file));
  if ('heritageClauses' in node && node.heritageClauses)
    item.data['heritage'] = (node.heritageClauses as ts.NodeArray<ts.Node>).map((value) => value.getText(file));
  if (item.type === 'type') item.data['declaration'] = node.getText(file);
  if (ts.isImportDeclaration(node)) item.data['clause'] = node.importClause?.getText(file) ?? null;
  if (ts.isJsxAttribute(node)) item.data['value'] = node.initializer?.getText(file) ?? null;
  if (ts.isJsxSpreadAttribute(node)) item.data['spread'] = node.expression.getText(file);
}

export function extract(file: ts.SourceFile): { nodes: RawNode[]; originals: Map<string, ts.Node>; resolver: ScopeResolver } {
  const nodes: RawNode[] = [];
  const originals = new Map<string, ts.Node>();
  const resolver = createScopeResolver(file);
  const walk = (node: ts.Node, parent: string | null): void => {
    const cjs = commonJs(node, file, resolver);
    const info = describe(node, file) ?? cjs;
    let container = parent;
    if (info) {
      const item: RawNode = { ...info, id: String(nodes.length), parent, nativeType: ts.SyntaxKind[node.kind],
        start: node.getStart(file), end: node.end, parameters: [], returns: [], async: false,
        bodyStart: null, bodyEnd: null, role: 'member', data: cjs?.data ?? {} };
      populate(item, node, file);
      nodes.push(item); originals.set(item.id, node); container = item.id;
      if (isExported(node))
        nodes.push({ ...item, id: `export:${item.id}`, type: 'export', parent: item.parent,
          data: { declarationId: item.id }, parameters: [], returns: [], bodyStart: null, bodyEnd: null });
    }
    node.forEachChild((child) => { walk(child, container); });
  };
  walk(file, null);
  return { nodes, originals, resolver };
}
