import * as ts from 'typescript/ast';

export function callableName(node: ts.Node, file: ts.SourceFile): string | null {
    if ('name' in node && node.name) return (node.name as ts.Node).getText(file);
    let parent = node.parent;
    while (parent && (ts.isCallExpression(parent) || ts.isParenthesizedExpression(parent))) parent = parent.parent;
    return parent && ts.isVariableDeclaration(parent) ? parent.name.getText(file) : null;
}
