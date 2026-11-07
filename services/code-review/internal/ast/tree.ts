import Parser, { descendants } from './tree-runtime.js';
import { createRequire } from 'node:module';
import type { Language } from './schema.js';
import type { Range } from './schema.js';

const require = createRequire(import.meta.url),
    ready = Parser.init();
const grammars = new Map<string, Promise<Parser.Language>>();

export async function parseTree(language: Exclude<Language, 'js-ts'>, source: string) {
    await ready;
    if (!grammars.has(language))
        grammars.set(
            language,
            Parser.Language.load(require.resolve(`@vscode/tree-sitter-wasm/wasm/tree-sitter-${language}.wasm`)),
        );
    const parser = new Parser();
    parser.setLanguage(await grammars.get(language)!);
    const tree = parser.parse(source);
    if (!tree) {
        parser.delete();
        throw new Error('Supplementary syntax parser returned no tree');
    }
    return {
        tree,
        dispose: () => {
            tree.delete();
            parser.delete();
        },
    };
}

export function sourceLocator(source: string) {
    const lines = [0];
    for (const match of source.matchAll(/\r\n|\r|\n/g)) lines.push(match.index + match[0].length);
    const point = (offset: number) => {
        let low = 0,
            high = lines.length;
        while (low + 1 < high) {
            const mid = (low + high) >>> 1;
            if (lines[mid]! <= offset) low = mid;
            else high = mid;
        }
        return { line: low, character: offset - lines[low]! };
    };
    return (start: number, end: number): Range => ({ start: point(start), end: point(end) });
}

export const identifierNodes = (root: Parser.SyntaxNode) =>
    descendants(root, [
        'identifier',
        'field_identifier',
        'type_identifier',
        'package_identifier',
        'shorthand_field_identifier',
        'self',
    ]);
