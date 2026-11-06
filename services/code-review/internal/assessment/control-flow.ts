import * as ts from 'typescript/ast';
import { isLoop, location, text, type ScriptContext, type WalkContext } from './context.js';
import type { SyntaxEvidence } from './model.js';

function loop(context: ScriptContext, node: ts.Node, state: WalkContext): void {
  if (!isLoop(node)) return;
  context.output.loops.push({ ...location(context, node, 'loop'), functionId: state.functionId,
    parentLoopId: state.loops.at(-1) ?? null, kind: ts.SyntaxKind[node.kind], depth: state.loops.length + 1,
    initializer: ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) ? text(context, node.initializer) : null,
    condition: ts.isForStatement(node) ? text(context, node.condition)
      : ts.isWhileStatement(node) || ts.isDoStatement(node) ? text(context, node.expression) : null,
    update: ts.isForStatement(node) ? text(context, node.incrementor) : null,
    iterable: ts.isForOfStatement(node) || ts.isForInStatement(node) ? text(context, node.expression) : null });
}

function branch(context: ScriptContext, node: ts.Node, state: WalkContext): void {
  const condition = ts.isIfStatement(node) ? node.expression : ts.isConditionalExpression(node) ? node.condition
    : ts.isSwitchStatement(node) || ts.isCaseClause(node) ? node.expression : undefined;
  const logical = ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind);
  if (!condition && !logical && !ts.isCatchClause(node)) return;
  context.output.branches.push({ ...location(context, node, 'branch'), functionId: state.functionId,
    kind: logical ? ts.SyntaxKind[(node as ts.BinaryExpression).operatorToken.kind] : ts.SyntaxKind[node.kind],
    condition: text(context, condition ?? (logical ? (node as ts.BinaryExpression).left : undefined)) });
}

function exit(context: ScriptContext, node: ts.Node, state: WalkContext): void {
  const kinds = new Map<number, SyntaxEvidence['exits'][number]['kind']>([[ts.SyntaxKind.ReturnStatement, 'return'],
    [ts.SyntaxKind.ThrowStatement, 'throw'], [ts.SyntaxKind.BreakStatement, 'break'], [ts.SyntaxKind.ContinueStatement, 'continue'],
    [ts.SyntaxKind.AwaitExpression, 'await'], [ts.SyntaxKind.YieldExpression, 'yield']]);
  const kind = kinds.get(node.kind);
  if (!kind) return;
  const expression = ts.isReturnStatement(node) || ts.isThrowStatement(node) || ts.isAwaitExpression(node) || ts.isYieldExpression(node)
    ? node.expression : ts.isBreakStatement(node) || ts.isContinueStatement(node) ? node.label : undefined;
  context.output.exits.push({ ...location(context, node, 'exit'), functionId: state.functionId,
    kind, value: text(context, expression), enclosingLoopId: state.loops.at(-1) ?? null });
}

function allocation(context: ScriptContext, node: ts.Node, state: WalkContext): void {
  const kind = ts.isArrayLiteralExpression(node) ? 'array' : ts.isObjectLiteralExpression(node) ? 'object'
    : ts.isNewExpression(node) ? 'new' : ts.isFunctionExpression(node) || ts.isArrowFunction(node) ? 'closure' : null;
  if (!kind) return;
  // Creating a closure executes in its enclosing function, not in the new closure's body.
  const owner = kind === 'closure' ? context.locations.get(node.parent) ?? state : state;
  context.output.allocations.push({ ...location(context, node, 'allocation'), functionId: owner.functionId,
    kind, expression: text(context, node)!, loopIds: owner.loops });
}

function effect(context: ScriptContext, node: ts.Node, state: WalkContext): void {
  const assignment = ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
    && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
  const update = (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
    && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator);
  const kind = node.kind === ts.SyntaxKind.ThisKeyword ? 'this' : node.kind === ts.SyntaxKind.SuperKeyword ? 'super'
    : ts.isDeleteExpression(node) ? 'delete' : assignment ? 'assignment' : update ? 'update'
      : ts.isSpreadElement(node) || ts.isSpreadAssignment(node) ? 'spread' : ts.isTaggedTemplateExpression(node) ? 'tagged-call' : null;
  if (kind) context.output.effects.push({ ...location(context, node, 'effect'), functionId: state.functionId,
    kind, expression: text(context, node)! });
}

export function collectControlFlow(context: ScriptContext): void {
  const walk = (node: ts.Node): void => {
    const state = context.locations.get(node);
    if (!state) return;
    loop(context, node, state); branch(context, node, state); exit(context, node, state);
    allocation(context, node, state); effect(context, node, state);
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier))
      context.output.imports.push({ ...location(context, node, 'import'), source: node.moduleSpecifier.text, dynamic: false });
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      context.output.imports.push({ ...location(context, node, 'import'), source: text(context, node.arguments[0]) ?? '', dynamic: true });
    if (ts.isExportDeclaration(node) || ts.isExportAssignment(node) || isExportedNode(node))
      context.output.exports.push({ ...location(context, node, 'export'), name: 'name' in node ? text(context, node.name as ts.Node) : text(context, node) });
    node.forEachChild(walk);
  };
  walk(context.file);
}

function isExportedNode(node: ts.Node): boolean {
  return Boolean('modifierFlags' in node && (node.modifierFlags as number) & ts.ModifierFlags.Export);
}
