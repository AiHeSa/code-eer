import * as ts from 'typescript/ast';
import type { Environment } from './cost-expressions.js';

/** 只证明字面边界、单步更新且循环体不修改计数器的有限循环；其余返回未知。 */
export function finiteLoop(node: ts.ForStatement, env: Environment) {
    const init = node.initializer,
        condition = node.condition,
        update = node.incrementor;
    if (
        !init ||
        !ts.isVariableDeclarationList(init) ||
        init.declarations.length !== 1 ||
        !(init.flags & ts.NodeFlags.Let) ||
        !condition ||
        !ts.isBinaryExpression(condition) ||
        !update
    )
        return null;
    const variable = init.declarations[0]!;
    if (
        !ts.isIdentifier(variable.name) ||
        !variable.initializer ||
        !ts.isNumericLiteral(variable.initializer) ||
        !ts.isIdentifier(condition.left) ||
        condition.left.text !== variable.name.text ||
        !ts.isNumericLiteral(condition.right) ||
        (!ts.isPostfixUnaryExpression(update) && !ts.isPrefixUnaryExpression(update)) ||
        !ts.isIdentifier(update.operand) ||
        update.operand.text !== variable.name.text
    )
        return null;
    const start = Number(variable.initializer.text),
        end = Number(condition.right.text);
    const ascending = update.operator === ts.SyntaxKind.PlusPlusToken;
    const descending = update.operator === ts.SyntaxKind.MinusMinusToken;
    const inclusive = [ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(
        condition.operatorToken.kind,
    );
    if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        env.has(variable.name.text) ||
        (ascending &&
            ![ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken].includes(condition.operatorToken.kind)) ||
        (descending &&
            ![ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(
                condition.operatorToken.kind,
            )) ||
        (!ascending && !descending)
    )
        return null;
    // 该检查有意保守；不能由静态上界证明的循环不应被当作已满足预算。
    let mutation = false;
    const walk = (value: ts.Node): void => {
        if (
            ((ts.isBinaryExpression(value) &&
                value.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
                value.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
                ts.isPrefixUnaryExpression(value) ||
                ts.isPostfixUnaryExpression(value)) &&
            value.getText().includes(variable.name.getText())
        )
            mutation = true;
        value.forEachChild(walk);
    };
    walk(node.statement);
    const iterations = Math.max(0, (ascending ? end - start : start - end) + Number(inclusive));
    if (
        mutation ||
        !Number.isSafeInteger(iterations) ||
        iterations > 1000000 ||
        Math.abs(end) >= Number.MAX_SAFE_INTEGER
    )
        return null;
    const nested = new Map(env);
    nested.set(variable.name.text, { kind: 'number', value: null });
    return { iterations, env: nested };
}
