import * as ts from 'typescript/ast';

export interface Value { kind: 'number' | 'boolean' | 'string' | 'null' | 'unknown'; value: number | string | boolean | null }
export interface Cost { time: number; space: number; value: Value }
export type Environment = Map<string, Value>;
export type CallCostResolver = (node: ts.CallExpression) => { time: number; space: number } | null;
const unknown: Value = { kind: 'unknown', value: null };
export function expression(node: ts.Node | undefined, env: Environment, calls?: CallCostResolver): Cost | null {
  if (!node) return { time: 0, space: 0, value: unknown };
  if (ts.isNumericLiteral(node)) return { time: 1, space: 0, value: { kind: 'number', value: Number(node.text) } };
  if (ts.isStringLiteral(node)) return { time: 1, space: 0, value: { kind: 'string', value: node.text } };
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword)
    return { time: 1, space: 0, value: { kind: 'boolean', value: node.kind === ts.SyntaxKind.TrueKeyword } };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { time: 1, space: 0, value: { kind: 'null', value: null } };
  if (ts.isIdentifier(node)) return env.has(node.text) ? { time: 1, space: 0, value: env.get(node.text)! } : null;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)
    || ts.isSatisfiesExpression(node) || ts.isTypeAssertion(node)) return expression(node.expression, env, calls);
  if (ts.isBinaryExpression(node)) return binary(node, env, calls);
  if (ts.isCallExpression(node)) return call(node, env, calls);
  if (ts.isPrefixUnaryExpression(node)) {
    const operand = expression(node.operand, env, calls);
    if (!operand) return null;
    if (node.operator === ts.SyntaxKind.ExclamationToken) return { ...operand, time: operand.time + 1, value: { kind: 'boolean', value: null } };
    if (operand.value.kind !== 'number' || ![ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.TildeToken].includes(node.operator)) return null;
    return { ...operand, time: operand.time + 1, value: { kind: 'number', value: null } };
  }
  return null;
}

function binary(node: ts.BinaryExpression, env: Environment, calls?: CallCostResolver): Cost | null {
  const left = expression(node.left, env, calls), right = expression(node.right, env, calls), op = node.operatorToken.kind;
  if (!left || !right) return null;
  const numeric = [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken,
    ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken,
    ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken];
  const equality = [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken];
  if (!equality.includes(op) && (!numeric.includes(op) || left.value.kind !== 'number' || right.value.kind !== 'number')) return null;
  return { time: left.time + right.time + 1, space: Math.max(left.space, right.space),
    value: { kind: equality.includes(op) || op >= ts.SyntaxKind.LessThanToken && op <= ts.SyntaxKind.GreaterThanEqualsToken ? 'boolean' : 'number', value: null } };
}

function call(node: ts.CallExpression, env: Environment, calls?: CallCostResolver): Cost | null {
  const target = calls?.(node);
  if (!target || node.arguments.some((item) => ts.isSpreadElement(item))) return null;
  const args = node.arguments.map((item) => expression(item, env, calls));
  if (args.some((item) => !item)) return null;
  return { time: 1 + target.time + args.reduce((sum, item) => sum + item!.time, 0),
    space: target.space + args.reduce((sum, item) => sum + item!.space, 0), value: unknownValue() };
}

export const unknownValue = (): Value => ({ ...unknown });
