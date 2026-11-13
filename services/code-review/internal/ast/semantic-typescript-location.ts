import { SymbolFlags, type Project, type Symbol as TSymbol } from 'typescript/async';
import type { Node } from 'typescript/ast';
import { pathToFileURL } from 'node:url';
import { sourceLocator } from './tree.js';
import type { SemanticLocation } from './semantic-schema.js';

export async function typescriptDefinition(symbol: TSymbol, project: Project): Promise<SemanticLocation | null> {
    if (symbol.flags & SymbolFlags.Alias) symbol = await project.checker.getAliasedSymbol(symbol);
    const declaration = await (symbol.valueDeclaration ?? symbol.declarations[0])?.resolve(project);
    if (!declaration) return null;

    const file = declaration.getSourceFile();
    const name = 'name' in declaration ? (declaration.name as Node | undefined) : undefined;
    const node = name && typeof name.getStart === 'function' ? name : declaration;
    return { uri: pathToFileURL(file.fileName).href, range: sourceLocator(file.text)(node.getStart(file), node.end) };
}
