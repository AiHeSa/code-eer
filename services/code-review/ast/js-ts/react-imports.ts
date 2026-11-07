import * as ts from 'typescript/ast';
import type { ScopeResolver } from './scope.js';

export interface ImportEvidence {
    source: string;
    imported: string;
    declaration: ts.Identifier;
}

export function reactImports(file: ts.SourceFile): Map<string, ImportEvidence> {
    const names = new Map<string, ImportEvidence>();
    for (const statement of file.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const source = statement.moduleSpecifier.text;
        const clause = statement.importClause;
        if (clause?.name) names.set(clause.name.text, { source, imported: 'default', declaration: clause.name });
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings))
            names.set(bindings.name.text, { source, imported: '*', declaration: bindings.name });
        if (bindings && ts.isNamedImports(bindings))
            for (const entry of bindings.elements)
                names.set(entry.name.text, {
                    source,
                    imported: entry.propertyName?.text ?? entry.name.text,
                    declaration: entry.name,
                });
    }
    return names;
}

export function importedExpression(
    callee: ts.Node,
    names: Map<string, ImportEvidence>,
    resolver: ScopeResolver,
): ImportEvidence | undefined {
    const lookup = (identifier: ts.Identifier) => {
        const entry = names.get(identifier.text);
        return entry && resolver.resolve(identifier, identifier.text) === entry.declaration ? entry : undefined;
    };
    if (ts.isIdentifier(callee)) return lookup(callee);
    if (ts.isQualifiedName(callee) && ts.isIdentifier(callee.left)) {
        const imported = lookup(callee.left);
        return imported && ['*', 'default'].includes(imported.imported)
            ? { ...imported, imported: callee.right.text }
            : undefined;
    }
    if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return undefined;
    const imported = lookup(callee.expression);
    return imported && ['*', 'default'].includes(imported.imported)
        ? { ...imported, imported: callee.name.text }
        : undefined;
}
