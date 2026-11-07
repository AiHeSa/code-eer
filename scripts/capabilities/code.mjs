import * as ts from 'typescript/ast';
import { posix } from 'node:path';

function defaultExpression(file, path) {
    const exports = file.statements.filter(
        (node) =>
            ts.isExportAssignment(node) ||
            ts.isExportDeclaration(node) ||
            ('modifierFlags' in node && Boolean(node.modifierFlags & ts.ModifierFlags.Export)),
    );
    if (exports.length !== 1 || !ts.isExportAssignment(exports[0]) || exports[0].isExportEquals)
        throw new Error(`${path}: expose capability methods through one default definition`);
    return exports[0].expression;
}

function methodNames(expression, path) {
    if (!expression || !ts.isObjectLiteralExpression(expression))
        throw new Error(`${path}: declare methods in an object literal`);
    const names = expression.properties.map((property) => {
        if (
            !(
                ts.isMethodDeclaration(property) ||
                ts.isPropertyAssignment(property) ||
                ts.isShorthandPropertyAssignment(property)
            ) ||
            !property.name ||
            !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        )
            throw new Error(`${path}: capability methods require static names`);
        return property.name.text;
    });
    if (new Set(names).size !== names.length) throw new Error(`${path}: duplicate capability method`);
    return names;
}

function importBinding(file, name, imported) {
    for (const node of file.statements) {
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
        if (imported === 'default' && node.importClause?.name?.text === name) return node.moduleSpecifier.text;
        const bindings = node.importClause?.namedBindings;
        if (
            bindings &&
            ts.isNamedImports(bindings) &&
            bindings.elements.some(
                (entry) => entry.name.text === name && (entry.propertyName?.text ?? entry.name.text) === imported,
            )
        )
            return node.moduleSpecifier.text;
    }
    return undefined;
}

function matchesImport(path, specifier, expected) {
    if (!specifier?.startsWith('.')) return false;
    const resolved = posix.normalize(posix.join(posix.dirname(path), specifier));
    return (
        resolved === expected ||
        resolved.replace(
            /\.(?:js|mjs|cjs)$/,
            (extension) => ({ '.js': '.ts', '.mjs': '.mts', '.cjs': '.cts' })[extension],
        ) === expected
    );
}

export function codeMethods(file, path, common) {
    const expression = defaultExpression(file, path);
    if (!ts.isCallExpression(expression) || expression.arguments.length !== 1)
        throw new Error(`${path}: capability definition requires one method object`);
    const callee = expression.expression;
    if (common) {
        if (
            !ts.isPropertyAccessExpression(callee) ||
            callee.name.text !== 'specialize' ||
            !ts.isIdentifier(callee.expression) ||
            !matchesImport(path, importBinding(file, callee.expression.text, 'default'), common)
        )
            throw new Error(`${path}: inherit with the common default import's specialize method`);
    } else if (
        !ts.isIdentifier(callee) ||
        !matchesImport(
            path,
            importBinding(file, callee.text, 'defineCapability'),
            'services/code-review/internal/capabilities/contract.ts',
        )
    )
        throw new Error(`${path}: define the common capability with defineCapability`);
    return methodNames(expression.arguments[0], path);
}
