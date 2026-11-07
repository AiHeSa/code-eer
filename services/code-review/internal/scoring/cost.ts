import * as ts from 'typescript/ast';
import { expression, unknownValue, type Cost, type Environment, type CallCostResolver } from './cost-expressions.js';
import { finiteLoop } from './cost-loops.js';

export interface CostSummary { time: number; space: number; pure: boolean; isolated: boolean; model: string }
const zero = (): Cost => ({ time: 0, space: 0, value: unknownValue() });
function sequence(nodes: readonly ts.Node[], env: Environment, calls?: CallCostResolver): Cost | null {
  const total = zero();
  for (const node of nodes) {
    const item = statement(node, env, calls);
    if (!item) return null;
    total.time += item.time; total.space = Math.max(total.space, item.space);
  }
  return total;
}

function variables(node: ts.VariableStatement, env: Environment, calls?: CallCostResolver): Cost | null {
  let time = 0;
  for (const declaration of node.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return null;
    if (env.has(declaration.name.text)) return null;
    const value = expression(declaration.initializer, env, calls);
    if (!value) return null;
    env.set(declaration.name.text, value.value); time += value.time + 1;
  }
  return { time, space: env.size, value: unknownValue() };
}

function branch(node: ts.IfStatement, env: Environment, calls?: CallCostResolver): Cost | null {
  const condition = expression(node.expression, env, calls);
  const yes = statement(node.thenStatement, new Map(env), calls);
  const no = node.elseStatement ? statement(node.elseStatement, new Map(env), calls) : zero();
  if (!condition || !yes || !no) return null;
  return { time: condition.time + Math.max(yes.time, no.time), space: Math.max(yes.space, no.space), value: unknownValue() };
}

function statement(node: ts.Node, env: Environment, calls?: CallCostResolver): Cost | null {
  if (ts.isBlock(node)) return sequence(node.statements, new Map(env), calls);
  if (ts.isVariableStatement(node)) return variables(node, env, calls);
  if (ts.isReturnStatement(node)) {
    const cost = expression(node.expression, env, calls);
    return cost ? { ...cost, time: cost.time + 1 } : null;
  }
  if (ts.isIfStatement(node)) return branch(node, env, calls);
  if (ts.isForStatement(node)) {
    const loop = finiteLoop(node, env), body = loop ? statement(node.statement, loop.env, calls) : null;
    return loop && body ? { time: 2 + (loop.iterations + 1) * 3 + loop.iterations * (body.time + 2),
      space: body.space + loop.env.size, value: unknownValue() } : null;
  }
  if (ts.isEmptyStatement(node)) return zero();
  if (ts.isExpressionStatement(node)) return expression(node.expression, env, calls);
  return null;
}

export function deriveCost(node: ts.FunctionLikeDeclaration, calls?: CallCostResolver): CostSummary | null {
  if (!node.body || node.modifierFlags & ts.ModifierFlags.Async || node.asteriskToken) return null;
  if (node.parameters.some((item) => item.initializer || item.dotDotDotToken || !ts.isIdentifier(item.name))) return null;
  const env: Environment = new Map(node.parameters.map((item) => [item.name.getText(), unknownValue()]));
  const cost = ts.isBlock(node.body) ? statement(node.body, env, calls) : expression(node.body, env, calls);
  let isolated = true;
  const check = (value: ts.Node): void => {
    if (ts.isReturnStatement(value) && value.expression && expression(value.expression, new Map())?.value.kind === undefined) isolated = false;
    value.forEachChild(check);
  };
  if (ts.isBlock(node.body)) check(node.body);
  else isolated = expression(node.body, new Map()) !== null;
  return cost && Number.isFinite(cost.time) ? { time: cost.time, space: Math.max(1, env.size + cost.space),
    pure: true, isolated, model: 'primitive-source-operations-v2; finite literal loops and resolved finite callees; dynamic costs rejected' } : null;
}
