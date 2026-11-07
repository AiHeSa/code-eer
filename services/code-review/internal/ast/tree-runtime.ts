import { createRequire } from 'node:module';
import type { Node, Language as WasmLanguage } from '@vscode/tree-sitter-wasm';

const runtime = createRequire(import.meta.url)('@vscode/tree-sitter-wasm') as typeof import('@vscode/tree-sitter-wasm');

class Parser extends runtime.Parser {
    static Language = runtime.Language;
}

namespace Parser {
    export type SyntaxNode = Node;
    export type Language = WasmLanguage;
}

export type SyntaxNode = Node;

export const named = (node: Node | null | undefined): Node[] =>
    node?.namedChildren.filter((child): child is Node => child !== null) ?? [];
export const children = (node: Node | null | undefined): Node[] =>
    node?.children.filter((child): child is Node => child !== null) ?? [];
export const descendants = (node: Node | null | undefined, types: string | string[]): Node[] =>
    node?.descendantsOfType(types).filter((child): child is Node => child !== null) ?? [];

export default Parser;
