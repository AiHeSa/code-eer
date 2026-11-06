import * as ts from 'typescript/ast';
import { importedExpression, reactImports } from './react-imports.js';
import type { ScopeResolver } from './scope.js';

function objectValue(node: ts.Node, resolver: ScopeResolver, visited = new Set<ts.Node>()): ts.ObjectLiteralExpression | undefined {
  if (visited.has(node)) return undefined;
  visited.add(node);
  if (ts.isObjectLiteralExpression(node)) return node;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))
    return objectValue(node.expression, resolver, visited);
  if (ts.isIdentifier(node)) {
    const declaration = resolver.resolve(node, node.text)?.parent;
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer)
      return objectValue(declaration.initializer, resolver, visited);
  }
  return undefined;
}
export function vueOptions(file: ts.SourceFile, resolver: ScopeResolver): Set<ts.Node> {
  const objects = new Set<ts.Node>();
  const imports = reactImports(file);
  const add = (node: ts.Node | undefined) => {
    const object = node ? objectValue(node, resolver) : undefined;
    if (object) objects.add(object);
  };
  const walk = (node: ts.Node): void => {
    if (ts.isExportAssignment(node) && !node.isExportEquals) add(node.expression);
    if (ts.isCallExpression(node)) {
      const imported = importedExpression(node.expression, imports, resolver);
      if (imported?.source === 'vue' && imported.imported === 'defineComponent'
        || ts.isIdentifier(node.expression) && node.expression.text === 'defineComponent'
          && !resolver.resolve(node.expression, 'defineComponent')) add(node.arguments[0]);
    }
    node.forEachChild((child) => { walk(child); });
  };
  walk(file);
  return objects;
}
