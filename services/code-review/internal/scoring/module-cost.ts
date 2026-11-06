import * as ts from 'typescript/ast';
import { expression, unknownValue, type Environment } from './cost-expressions.js';
import type { CostSummary } from './cost.js';

function declarations(node: ts.VariableStatement, env: Environment): number | null {
  let time = 0;
  for (const declaration of node.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer || env.has(declaration.name.text)) return null;
    const initializer = declaration.initializer;
    if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
      env.set(declaration.name.text, unknownValue()); time += 2; continue;
    }
    const value = expression(initializer, env);
    if (!value) return null;
    env.set(declaration.name.text, value.value); time += value.time + 1;
  }
  return time;
}

export function deriveModuleCost(file: ts.SourceFile): CostSummary | null {
  const env: Environment = new Map();
  let time = 0;
  for (const node of file.statements) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isInterfaceDeclaration(node)
      || ts.isTypeAliasDeclaration(node) || ts.isEmptyStatement(node)) continue;
    if (ts.isFunctionDeclaration(node)) { time++; if (node.name) env.set(node.name.text, unknownValue()); continue; }
    if (ts.isVariableStatement(node)) {
      const cost = declarations(node, env);
      if (cost === null) return null;
      time += cost; continue;
    }
    if (ts.isExportAssignment(node)) {
      const value = expression(node.expression, env);
      if (!value) return null;
      time += value.time; continue;
    }
    return null;
  }
  return { time, space: env.size, pure: false, isolated: false,
    model: 'primitive-source-operations-v1; own module definitions; imported module execution excluded; module-lifetime retention expected' };
}
