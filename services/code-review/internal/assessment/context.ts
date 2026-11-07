import * as ts from 'typescript/ast';
import { emptyEvidence, type SyntaxEvidence } from './model.js';

export interface WalkContext {
    scopeId: string;
    functionId: string | null;
    loops: string[];
    dynamicScope: boolean;
}

export interface ScriptContext {
    file: ts.SourceFile;
    source: string;
    offset: number;
    prefix: string;
    output: SyntaxEvidence;
    lineStarts: number[];
    locations: Map<ts.Node, WalkContext>;
    names: Set<ts.Identifier>;
    bindings: Map<ts.Identifier, string>;
    functionNodes: Map<ts.Node, string>;
    functionTargets: Map<string, string>;
}

export function scriptContext(file: ts.SourceFile, source: string, offset = 0, prefix = ''): ScriptContext {
    const lineStarts = [0];
    for (const match of source.matchAll(/\r\n|\r|\n/g)) lineStarts.push(match.index + match[0].length);
    return {
        file,
        source,
        offset,
        prefix,
        output: emptyEvidence(),
        locations: new Map(),
        names: new Set(),
        bindings: new Map(),
        functionNodes: new Map(),
        functionTargets: new Map(),
        lineStarts,
    };
}

function point(context: ScriptContext, offset: number) {
    let low = 0;
    let high = context.lineStarts.length;
    while (low + 1 < high) {
        const middle = Math.floor((low + high) / 2);
        if (context.lineStarts[middle]! <= offset) low = middle;
        else high = middle;
    }
    return { line: low, character: offset - context.lineStarts[low]! };
}

export function location(context: ScriptContext, node: ts.Node, kind: string) {
    const start = node.getStart(context.file);
    return {
        id: `${context.prefix}${kind}:${node.kind}:${start}:${node.end}`,
        range: { start: point(context, context.offset + start), end: point(context, context.offset + node.end) },
    };
}

export function text(context: ScriptContext, node: ts.Node | undefined): string | null {
    return node ? node.getText(context.file) : null;
}

export function isFunction(node: ts.Node): node is ts.FunctionLikeDeclaration {
    return ts.isFunctionLikeDeclaration(node);
}

export function unwrap(node: ts.Expression): ts.Expression {
    while (
        ts.isParenthesizedExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isNonNullExpression(node) ||
        ts.isSatisfiesExpression(node) ||
        ts.isTypeAssertion(node)
    )
        node = node.expression;
    return node;
}

export function isImmediate(node: ts.Node): boolean {
    let value = node;
    while (
        ts.isParenthesizedExpression(value.parent) ||
        ts.isAsExpression(value.parent) ||
        ts.isNonNullExpression(value.parent) ||
        ts.isSatisfiesExpression(value.parent)
    )
        value = value.parent;
    return ts.isCallExpression(value.parent) && value.parent.expression === value;
}

export function isLoop(
    node: ts.Node,
): node is ts.ForStatement | ts.ForOfStatement | ts.ForInStatement | ts.WhileStatement | ts.DoStatement {
    return (
        ts.isForStatement(node) ||
        ts.isForOfStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isWhileStatement(node) ||
        ts.isDoStatement(node)
    );
}
