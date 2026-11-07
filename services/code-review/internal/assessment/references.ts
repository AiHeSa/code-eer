import * as ts from 'typescript/ast';
import { createScopeResolver } from '../../ast/js-ts/scope.js';
import { location, text, unwrap, type ScriptContext, type WalkContext } from './context.js';
import type { Reference } from './model.js';

function valueIdentifier(context: ScriptContext, node: ts.Identifier): boolean {
    const parent = node.parent;
    if (context.names.has(node) || !context.locations.has(node)) return false;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
    if (ts.isPropertyAssignment(parent) && parent.name === node && !ts.isComputedPropertyName(parent.name))
        return false;
    if (
        (ts.isMethodDeclaration(parent) ||
            ts.isPropertyDeclaration(parent) ||
            ts.isGetAccessorDeclaration(parent) ||
            ts.isSetAccessorDeclaration(parent) ||
            ts.isEnumMember(parent)) &&
        parent.name === node
    )
        return false;
    if (
        ts.isImportSpecifier(parent) ||
        ts.isImportClause(parent) ||
        ts.isNamespaceImport(parent) ||
        ts.isImportEqualsDeclaration(parent) ||
        ts.isExportSpecifier(parent)
    )
        return false;
    if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
    if (ts.isLabeledStatement(parent) || ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) return false;
    if (
        ts.isJsxAttribute(parent) ||
        ts.isJsxOpeningElement(parent) ||
        ts.isJsxClosingElement(parent) ||
        ts.isJsxSelfClosingElement(parent)
    )
        return false;
    return true;
}

function assignmentAccess(node: ts.Node): Reference['access'] {
    while (
        ts.isParenthesizedExpression(node.parent) ||
        ts.isArrayLiteralExpression(node.parent) ||
        ts.isObjectLiteralExpression(node.parent) ||
        ts.isShorthandPropertyAssignment(node.parent) ||
        ts.isSpreadAssignment(node.parent) ||
        ts.isSpreadElement(node.parent) ||
        (ts.isPropertyAssignment(node.parent) && node.parent.initializer === node)
    )
        node = node.parent;
    const parent = node.parent;
    if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))
        return [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(parent.operator)
            ? 'read-write'
            : 'read';
    if (ts.isDeleteExpression(parent)) return 'write';
    if (ts.isBinaryExpression(parent) && parent.left === node) {
        const token = parent.operatorToken.kind;
        if (token === ts.SyntaxKind.EqualsToken) return 'write';
        if (token >= ts.SyntaxKind.FirstAssignment && token <= ts.SyntaxKind.LastAssignment) return 'read-write';
    }
    if ((ts.isForOfStatement(parent) || ts.isForInStatement(parent)) && parent.initializer === node) return 'write';
    return 'read';
}

function access(context: ScriptContext, node: ts.Identifier): Pick<Reference, 'access' | 'property'> {
    let expression: ts.Node = node;
    while (
        (ts.isPropertyAccessExpression(expression.parent) || ts.isElementAccessExpression(expression.parent)) &&
        expression.parent.expression === expression
    )
        expression = expression.parent;
    const property = expression === node ? null : text(context, expression);
    return { access: assignmentAccess(expression), property };
}

function collectCall(
    context: ScriptContext,
    node: ts.CallExpression | ts.NewExpression,
    state: WalkContext,
    resolver: ReturnType<typeof createScopeResolver>,
): void {
    const expression = unwrap(node.expression);
    const declaration = ts.isIdentifier(expression) ? resolver.resolve(expression, expression.text) : undefined;
    const target = declaration ? context.bindings.get(declaration) : undefined;
    const direct = context.functionNodes.get(expression);
    const targetId = direct ?? (target ? context.functionTargets.get(target) : null) ?? null;
    context.output.calls.push({
        ...location(context, node, 'call'),
        functionId: state.functionId,
        callee: text(context, node.expression)!,
        arguments: node.arguments?.map((argument) => argument.getText(context.file)) ?? [],
        kind: ts.isNewExpression(node) ? 'new' : 'call',
        loopIds: state.loops,
        targetId,
        bindingId: target ?? null,
        resolution: targetId ? 'lexical' : 'unresolved',
    });
}

function invalidateMutableTargets(context: ScriptContext): void {
    const written = new Set(
        context.output.references
            .filter((item) => item.property === null && item.access !== 'read')
            .map((item) => item.targetId),
    );
    for (const call of context.output.calls) {
        const binding = context.output.declarations.find((item) => item.id === call.bindingId);
        if (
            call.targetId &&
            ((call.bindingId !== null && written.has(call.bindingId)) ||
                call.kind === 'new' ||
                binding?.kind === 'let' ||
                binding?.kind === 'var')
        ) {
            call.targetId = null;
            call.resolution = 'unresolved';
        }
    }
}

function exportBinding(context: ScriptContext, node: ts.Node, resolver: ReturnType<typeof createScopeResolver>): void {
    const names: ts.Identifier[] = [];
    if (
        ts.isExportDeclaration(node) &&
        !node.isTypeOnly &&
        !node.moduleSpecifier &&
        node.exportClause &&
        ts.isNamedExports(node.exportClause)
    ) {
        for (const item of node.exportClause.elements) {
            const name = item.propertyName ?? item.name;
            if (!item.isTypeOnly && ts.isIdentifier(name)) names.push(name);
        }
    }
    if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) names.push(node.expression);
    for (const name of names) {
        const target = resolver.resolve(node, name.text);
        const id = target ? context.bindings.get(target) : undefined;
        const declaration = context.output.declarations.find((item) => item.id === id);
        if (declaration) declaration.exported = true;
    }
}

export function collectReferences(context: ScriptContext): void {
    const resolver = createScopeResolver(context.file);
    const walk = (node: ts.Node): void => {
        const state = context.locations.get(node);
        if (!state) return;
        exportBinding(context, node, resolver);
        if (ts.isIdentifier(node) && valueIdentifier(context, node)) {
            const declaration = resolver.resolve(node, node.text);
            context.output.references.push({
                ...location(context, node, 'reference'),
                functionId: state.functionId,
                scopeId: state.scopeId,
                name: node.text,
                targetId: declaration ? (context.bindings.get(declaration) ?? null) : null,
                dynamicScope: state.dynamicScope,
                ...access(context, node),
            });
        }
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) collectCall(context, node, state, resolver);
        node.forEachChild(walk);
    };
    walk(context.file);
    invalidateMutableTargets(context);
    if (
        context.output.calls.some((call) => call.callee === 'eval') ||
        context.output.references.some((ref) => ref.dynamicScope)
    ) {
        context.output.coverage.limitations.push('eval/with prevents reliable lexical binding and call resolution');
        for (const ref of context.output.references) {
            ref.dynamicScope = true;
            ref.targetId = null;
        }
        for (const call of context.output.calls) {
            call.targetId = null;
            call.resolution = 'unresolved';
        }
    }
}
