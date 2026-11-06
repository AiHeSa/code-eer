import * as ts from 'typescript/ast';
import type { RawNode } from '../../internal/ast/raw.js';
import { importedExpression, type ImportEvidence } from './react-imports.js';
import type { ScopeResolver } from './scope.js';

function jsxWithin(node: ts.Node, root = true): boolean {
  if (!root && (ts.isFunctionLikeDeclaration(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node))) return false;
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return true;
  return node.forEachChild((child) => jsxWithin(child, false) || undefined) ?? false;
}
function isDefault(node: ts.Node): boolean {
  if ('modifierFlags' in node && Boolean((node.modifierFlags as number) & ts.ModifierFlags.Default)) return true;
  let parent = node.parent;
  while (parent && (ts.isCallExpression(parent) || ts.isParenthesizedExpression(parent))) parent = parent.parent;
  return Boolean(parent && ts.isExportAssignment(parent) && !parent.isExportEquals);
}
export function componentEvidence(fact: RawNode, node: ts.Node, names: Map<string, ImportEvidence>,
  resolver: ScopeResolver): { name: string; evidence: string[] } | undefined {
  if (!['function', 'type'].includes(fact.type)) return undefined;
  const defaultExport = isDefault(node);
  if (!defaultExport && (!fact.name || !/^[A-Z]/.test(fact.name))) return undefined;
  const evidence: string[] = [];
  if (jsxWithin(node)) evidence.push('jsx');
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    for (const clause of node.heritageClauses ?? []) for (const base of clause.types) {
      const expression = 'expression' in base ? base.expression : ts.isTypeReferenceNode(base) ? base.typeName : undefined;
      const imported = expression ? importedExpression(expression, names, resolver) : undefined;
      if (imported?.source === 'react' && ['Component', 'PureComponent'].includes(imported.imported)) evidence.push('reactBaseClass');
    }
  }
  if (!evidence.length) return undefined;
  return { name: fact.name ?? 'default', evidence: [...evidence, defaultExport ? 'defaultExport' : 'declarationName'] };
}
