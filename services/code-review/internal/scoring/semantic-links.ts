import * as ts from 'typescript/ast';
import { collectReferences } from '../assessment/references.js';
import { location, unwrap, type ScriptContext } from '../assessment/context.js';
import { createScopeResolver } from '../../ast/js-ts/scope.js';

export interface BindingReference {
    bindingId: string;
    members: string[];
}

export interface ExportLink {
    name: string;
    imported: string;
    source: string;
}

export interface SemanticLinks {
    aliases: Map<string, BindingReference>;
    calls: Map<string, BindingReference>;
    objects: Map<string, Map<string, string>>;
    namespaces: Map<string, string>;
    exportBindings: Map<string, BindingReference>;
    reexports: ExportLink[];
}

export const emptyLinks = (): SemanticLinks => ({
    aliases: new Map(),
    calls: new Map(),
    objects: new Map(),
    namespaces: new Map(),
    exportBindings: new Map(),
    reexports: [],
});

function reference(
    node: ts.Expression,
    context: ScriptContext,
    resolver: ReturnType<typeof createScopeResolver>,
): BindingReference | null {
    let value = unwrap(node);
    const members: string[] = [];
    while (ts.isPropertyAccessExpression(value) && !value.questionDotToken) {
        members.unshift(value.name.text);
        value = unwrap(value.expression);
    }
    if (!ts.isIdentifier(value)) return null;
    const name = resolver.resolve(value, value.text),
        id = name ? context.bindings.get(name) : null;
    return id ? { bindingId: id, members } : null;
}

function variable(
    node: ts.VariableDeclaration,
    context: ScriptContext,
    links: SemanticLinks,
    resolver: ReturnType<typeof createScopeResolver>,
): void {
    if (
        !ts.isIdentifier(node.name) ||
        !node.initializer ||
        !ts.isVariableDeclarationList(node.parent) ||
        !(node.parent.flags & ts.NodeFlags.Const)
    )
        return;
    const id = context.bindings.get(node.name),
        value = unwrap(node.initializer);
    if (!id) return;
    const alias = reference(value, context, resolver);
    if (alias) links.aliases.set(id, alias);
    if (!ts.isObjectLiteralExpression(value)) return;
    const methods = new Map<string, string>();
    for (const item of value.properties) {
        if (
            (!ts.isMethodDeclaration(item) && !ts.isPropertyAssignment(item)) ||
            !item.name ||
            (!ts.isIdentifier(item.name) && !ts.isStringLiteral(item.name)) ||
            item.name.text === '__proto__'
        )
            return;
        const fn = ts.isMethodDeclaration(item)
            ? context.functionNodes.get(item)
            : context.functionNodes.get(unwrap(item.initializer));
        if (!fn || methods.has(item.name.text)) return;
        methods.set(item.name.text, fn);
    }
    links.objects.set(id, methods);
}

function exports(
    node: ts.Node,
    context: ScriptContext,
    links: SemanticLinks,
    resolver: ReturnType<typeof createScopeResolver>,
): void {
    if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
        const source =
            node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null;
        if (source && !node.exportClause) links.reexports.push({ name: '*', imported: '*', source });
        if (source && node.exportClause && ts.isNamespaceExport(node.exportClause))
            links.reexports.push({ name: node.exportClause.name.text, imported: '*', source });
        if (node.exportClause && ts.isNamedExports(node.exportClause))
            for (const item of node.exportClause.elements) {
                if (item.isTypeOnly) continue;
                const name = item.name.text,
                    imported = (item.propertyName ?? item.name).text;
                if (source) links.reexports.push({ name, imported, source });
                else {
                    const binding = resolver.resolve(node, imported),
                        id = binding ? context.bindings.get(binding) : null;
                    if (id) links.exportBindings.set(name, { bindingId: id, members: [] });
                }
            }
    }
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
        const target = reference(node.expression, context, resolver);
        if (target) links.exportBindings.set('default', target);
    }
}

export function collectSemanticLinks(context: ScriptContext): SemanticLinks {
    const links = emptyLinks(),
        resolver = createScopeResolver(context.file);
    collectReferences(context);
    const walk = (node: ts.Node): void => {
        if (ts.isTypeNode(node)) return;
        if (ts.isVariableDeclaration(node)) variable(node, context, links, resolver);
        if (ts.isCallExpression(node)) {
            const target = reference(node.expression, context, resolver);
            if (target) links.calls.set(location(context, node, 'call').id, target);
        }
        if (
            ts.isImportDeclaration(node) &&
            node.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            const bindings = node.importClause?.namedBindings;
            if (bindings && ts.isNamespaceImport(bindings)) {
                const id = context.bindings.get(bindings.name);
                if (id) links.namespaces.set(id, node.moduleSpecifier.text);
            }
        }
        exports(node, context, links, resolver);
        node.forEachChild(walk);
    };
    walk(context.file);
    for (const declaration of context.output.declarations)
        if (declaration.exported)
            links.exportBindings.set(declaration.name, { bindingId: declaration.id, members: [] });
    return links;
}
