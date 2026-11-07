import * as ts from 'typescript/ast';
import type { RawNode } from '../../internal/ast/raw.js';
import type { ScopeResolver } from './scope.js';

function property(node: ts.Node): { base: ts.Node; name: string } | undefined {
    if (ts.isPropertyAccessExpression(node)) return { base: node.expression, name: node.name.text };
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression))
        return { base: node.expression, name: node.argumentExpression.text };
    return undefined;
}

function global(node: ts.Node, name: string, resolver: ScopeResolver): boolean {
    return ts.isIdentifier(node) && node.text === name && !resolver.resolve(node, name);
}

function exportName(node: ts.Node, resolver: ScopeResolver): string | undefined {
    const member = property(node);
    if (!member) return undefined;
    if (global(member.base, 'module', resolver) && member.name === 'exports') return 'default';
    if (global(member.base, 'exports', resolver)) return member.name;
    const container = property(member.base);
    return container && container.name === 'exports' && global(container.base, 'module', resolver)
        ? member.name
        : undefined;
}

export function commonJs(
    node: ts.Node,
    file: ts.SourceFile,
    resolver: ScopeResolver,
): { type: RawNode['type']; name: string; data: RawNode['data'] } | undefined {
    if (ts.isCallExpression(node) && global(node.expression, 'require', resolver) && node.arguments.length === 1) {
        const argument = node.arguments[0]!;
        return {
            type: 'import',
            name: argument.getText(file),
            data: {
                moduleSystem: 'commonjs',
                source: ts.isStringLiteral(argument) ? argument.text : null,
                dynamic: !ts.isStringLiteral(argument),
            },
        };
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const name = exportName(node.left, resolver);
        if (name !== undefined)
            return { type: 'export', name, data: { moduleSystem: 'commonjs', value: node.right.getText(file) } };
    }
    return undefined;
}
