import * as ts from 'typescript/ast';
import { bindingNames } from '../../ast/js-ts/scope.js';
import type { SemanticResult } from './semantic-schema.js';
import type { SetupBinding } from './semantic-vue-template.js';
import { sourceLocator } from './tree.js';

type ImportName = { identifier: ts.Identifier; defaultSource?: string };

function imports(statement: ts.ImportDeclaration): ImportName[] {
    const clause = statement.importClause;
    if (!clause || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return [];
    const source = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : undefined;
    const entry = (identifier: ts.Identifier, defaultImport = false): ImportName =>
        defaultImport && source ? { identifier, defaultSource: source } : { identifier };
    const names = clause.name ? [entry(clause.name, true)] : [];
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.push(entry(bindings.name));
    if (bindings && ts.isNamedImports(bindings))
        for (const item of bindings.elements)
            if (!item.isTypeOnly) names.push(entry(item.name, item.propertyName?.text === 'default'));
    return names;
}

function topLevelNames(statement: ts.Statement): ImportName[] {
    if (ts.isImportDeclaration(statement)) return imports(statement);
    if (ts.isVariableStatement(statement))
        return statement.declarationList.declarations.flatMap((declaration) =>
            bindingNames(declaration.name).map((identifier) => ({ identifier })),
        );
    if (
        (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) &&
        statement.name
    )
        return [{ identifier: statement.name }];
    return [];
}

export type SetupBindings = Map<string, SetupBinding & { defaultSource?: string }>;

export function setupBindings(
    file: ts.SourceFile,
    references: SemanticResult['references'],
    uri: string,
): SetupBindings {
    const byStart = new Map(references.map((ref) => [`${ref.range.start.line}:${ref.range.start.character}`, ref]));
    const locate = sourceLocator(file.text);
    const result: SetupBindings = new Map();
    for (const statement of file.statements) {
        for (const { identifier: name, defaultSource } of topLevelNames(statement)) {
            const point = locate(name.getStart(file), name.end).start;
            const ref = byStart.get(`${point.line}:${point.character}`);
            if (!ref) continue;
            result.set(name.text, {
                kind: 'setup',
                definition: { uri, range: ref.range },
                componentDefinition: ts.isImportDeclaration(statement) ? ref.definition : null,
                type: ref.type,
                ...(defaultSource ? { defaultSource } : {}),
            });
        }
    }
    return result;
}
