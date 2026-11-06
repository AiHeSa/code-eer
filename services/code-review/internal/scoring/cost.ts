import * as ts from 'typescript/ast';
import { expression, unknownValue, type Cost, type Environment } from './cost-expressions.js';

export interface CostSummary { time: number; space: number; pure: boolean; isolated: boolean; model: string }
const zero = (): Cost => ({ time: 0, space: 0, value: unknownValue() });
function sequence(nodes: readonly ts.Node[], env: Environment): Cost | null {
  const total = zero();
  for (const node of nodes) {
    const item = statement(node, env);
    if (!item) return null;
    total.time += item.time; total.space = Math.max(total.space, item.space);
  }
  return total;
}

function variables(node: ts.VariableStatement, env: Environment): Cost | null {
  let time = 0;
  for (const declaration of node.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return null;
    if (env.has(declaration.name.text)) return null;
    const value = expression(declaration.initializer, env);
    if (!value) return null;
    env.set(declaration.name.text, value.value); time += value.time + 1;
  }
  return { time, space: env.size, value: unknownValue() };
}

function branch(node: ts.IfStatement, env: Environment): Cost | null {
  const condition = expression(node.expression, env);
  const yes = statement(node.thenStatement, new Map(env));
  const no = node.elseStatement ? statement(node.elseStatement, new Map(env)) : zero();
  if (!condition || !yes || !no) return null;
  return { time: condition.time + Math.max(yes.time, no.time), space: Math.max(yes.space, no.space), value: unknownValue() };
}

function statement(node: ts.Node, env: Environment): Cost | null {
  if (ts.isBlock(node)) return sequence(node.statements, new Map(env));
  if (ts.isVariableStatement(node)) return variables(node, env);
  if (ts.isReturnStatement(node)) {
    const cost = expression(node.expression, env);
    return cost ? { ...cost, time: cost.time + 1 } : null;
  }
  if (ts.isIfStatement(node)) return branch(node, env);
  if (ts.isEmptyStatement(node)) return zero();
  if (ts.isExpressionStatement(node)) return expression(node.expression, env);
  return null;
}

export function deriveCost(node: ts.FunctionLikeDeclaration): CostSummary | null {
  if (!node.body || node.modifierFlags & ts.ModifierFlags.Async || node.asteriskToken) return null;
  if (node.parameters.some((item) => item.initializer || item.dotDotDotToken || !ts.isIdentifier(item.name))) return null;
  const env: Environment = new Map(node.parameters.map((item) => [item.name.getText(), unknownValue()]));
  const cost = ts.isBlock(node.body) ? statement(node.body, env) : expression(node.body, env);
  let isolated = true;
  const check = (value: ts.Node): void => {
    if (ts.isReturnStatement(value) && value.expression && expression(value.expression, new Map())?.value.kind === undefined) isolated = false;
    value.forEachChild(check);
  };
  if (ts.isBlock(node.body)) check(node.body);
  else isolated = expression(node.body, new Map()) !== null;
  return cost && Number.isFinite(cost.time) ? { time: cost.time, space: Math.max(1, env.size + cost.space),
    pure: true, isolated, model: 'primitive-source-operations-v1; unknown coercions, calls, loops and allocations rejected' } : null;
}
