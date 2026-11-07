import * as ts from 'typescript/ast';
import { expression, unknownValue, type Environment } from './cost-expressions.js';
import { finiteLoop } from './cost-loops.js';

function value(node: ts.Node | undefined, env: Environment): boolean {
    if (!node) return true;
    if (expression(node, env)) return true;
    if (
        ts.isParenthesizedExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isNonNullExpression(node) ||
        ts.isTypeAssertion(node) ||
        ts.isSatisfiesExpression(node)
    )
        return value(node.expression, env);
    if (ts.isCallExpression(node)) return node.arguments.every((item) => !ts.isSpreadElement(item) && value(item, env));
    if (ts.isTypeOfExpression(node) || ts.isVoidExpression(node)) return value(node.expression, env);
    if (ts.isConditionalExpression(node))
        return value(node.condition, env) && value(node.whenTrue, env) && value(node.whenFalse, env);
    if (
        ts.isBinaryExpression(node) &&
        [
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            ts.SyntaxKind.ExclamationEqualsEqualsToken,
            ts.SyntaxKind.AmpersandAmpersandToken,
            ts.SyntaxKind.BarBarToken,
            ts.SyntaxKind.QuestionQuestionToken,
        ].includes(node.operatorToken.kind)
    )
        return value(node.left, env) && value(node.right, env);
    return false;
}

function statement(node: ts.Node, env: Environment): boolean {
    if (ts.isBlock(node)) {
        const nested = new Map(env);
        return node.statements.every((item) => statement(item, nested));
    }
    if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) return value(node.expression, env);
    if (ts.isExpressionStatement(node)) return value(node.expression, env);
    if (ts.isIfStatement(node))
        return (
            value(node.expression, env) &&
            statement(node.thenStatement, new Map(env)) &&
            (!node.elseStatement || statement(node.elseStatement, new Map(env)))
        );
    if (ts.isVariableStatement(node))
        return node.declarationList.declarations.every((item) => {
            if (!ts.isIdentifier(item.name) || env.has(item.name.text) || !value(item.initializer, env)) return false;
            env.set(item.name.text, expression(item.initializer, env)?.value ?? unknownValue());
            return true;
        });
    if (ts.isForStatement(node)) {
        const loop = finiteLoop(node, env);
        return Boolean(loop && statement(node.statement, loop.env));
    }
    return ts.isEmptyStatement(node);
}

export function localPurity(node: ts.FunctionLikeDeclaration): boolean {
    if (
        !node.body ||
        node.modifierFlags & ts.ModifierFlags.Async ||
        node.asteriskToken ||
        node.parameters.some((item) => item.initializer || item.dotDotDotToken || !ts.isIdentifier(item.name))
    )
        return false;
    const env: Environment = new Map(node.parameters.map((item) => [item.name.getText(), unknownValue()]));
    return ts.isBlock(node.body) ? statement(node.body, env) : value(node.body, env);
}
