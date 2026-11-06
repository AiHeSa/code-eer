import * as ts from 'typescript/ast';
import type { RawNode } from '../../internal/ast/raw.js';
import type { ScopeResolver } from './scope.js';
import { vueOptions } from './vue-options.js';

const macros = new Set(['defineProps', 'defineEmits', 'defineModel', 'defineExpose', 'defineOptions', 'defineSlots', 'withDefaults']);
const options = new Set(['props', 'emits', 'components', 'setup', 'data', 'computed', 'methods', 'watch', 'provide', 'inject']);

function topLevelMacro(node: ts.Node, resolver: ScopeResolver): boolean {
  let parent = node.parent;
  if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 'withDefaults'
    && parent.arguments[0] === node && !resolver.resolve(parent.expression, 'withDefaults')) return topLevelMacro(parent, resolver);
  while (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent)
    || ts.isAssertionExpression(parent) || ts.isNonNullExpression(parent)) parent = parent.parent;
  if (ts.isVariableDeclaration(parent)) {
    const statement = parent.parent.parent;
    return ts.isVariableStatement(statement) && ts.isSourceFile(statement.parent);
  }
  return ts.isExpressionStatement(parent) && ts.isSourceFile(parent.parent);
}
function macroCall(node: ts.CallExpression, resolver: ScopeResolver, setup: boolean): boolean {
  if (!setup || !ts.isIdentifier(node.expression) || !macros.has(node.expression.text)
    || resolver.resolve(node.expression, node.expression.text)) return false;
  return topLevelMacro(node, resolver);
}
export function addVueScript(file: ts.SourceFile, nodes: RawNode[], originals: Map<string, ts.Node>,
  resolver: ScopeResolver, setup: boolean): void {
  const reverse = new Map([...originals].map(([id, node]) => [node, id]));
  const objects = vueOptions(file, resolver);
  const walk = (node: ts.Node, parent: string | null): void => {
    const container = reverse.get(node) ?? parent;
    let usage: string | undefined;
    let name: string | null = null;
    if (ts.isCallExpression(node)) {
      name = node.expression.getText(file);
      usage = macroCall(node, resolver, setup) ? 'compilerMacro' : 'callCandidate';
    }
    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node)
      || ts.isGetAccessorDeclaration(node)) && objects.has(node.parent) && options.has(node.name.getText(file).replace(/^['"]|['"]$/g, ''))) {
      name = node.name.getText(file).replace(/^['"]|['"]$/g, ''); usage = 'optionCandidate';
    }
    if (usage) nodes.push({ id: String(nodes.length), parent: container, type: 'binding', name,
      nativeType: ts.SyntaxKind[node.kind], start: node.getStart(file), end: node.end,
      parameters: [], returns: [], async: false, bodyStart: null, bodyEnd: null, role: 'framework',
      data: { usage, expression: node.getText(file), bindingResolution: 'syntax' } });
    node.forEachChild((child) => { walk(child, container); });
  };
  walk(file, null);
}
