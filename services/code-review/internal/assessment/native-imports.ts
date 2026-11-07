import { named, children, descendants, type SyntaxNode } from '../ast/tree-runtime.js';
import { child } from './native-profile.js';

function rustNames(node: SyntaxNode, prefix?: SyntaxNode | null): SyntaxNode[] {
    if (node.type === 'use_as_clause') return child(node, 'alias') ? [child(node, 'alias')!] : [];
    if (node.type === 'scoped_use_list')
        return named(node).flatMap((item) => (item.type === 'use_list' ? rustNames(item, child(node, 'path')) : []));
    if (node.type === 'use_list') return named(node).flatMap((item) => rustNames(item, prefix));
    if (node.type === 'scoped_identifier') return child(node, 'name') ? [child(node, 'name')!] : [];
    if (node.type === 'self') return prefix ? [child(prefix, 'name') ?? prefix] : [];
    return node.type === 'identifier' || node.type === 'type_identifier' ? [node] : [];
}

export function importNames(
    language: string,
    node: SyntaxNode,
    semantic?: { source: string; name?: string | undefined }[],
): { node: SyntaxNode; name: string }[] {
    if (language === 'python') {
        const module = child(node, 'module_name');
        return named(node)
            .filter((item) => item.id !== module?.id)
            .flatMap((item) => {
                const name =
                    child(item, 'alias') ??
                    (node.type === 'import_statement'
                        ? descendants(item, 'identifier')[0]
                        : descendants(item, 'identifier').at(-1)) ??
                    (item.type === 'identifier' ? item : null);
                return name ? [{ node: name, name: name.text }] : [];
            });
    }
    if (language === 'go') {
        const explicit = child(node, 'name'),
            path = child(node, 'path');
        if (explicit) return explicit.type === 'identifier' ? [{ node: explicit, name: explicit.text }] : [];
        if (!path) return [];
        let source = path.text;
        try {
            source = JSON.parse(source) as string;
        } catch {
            source = source.replace(/^`|`$/g, '');
        }
        const name = semantic?.find((item) => item.source === source)?.name;
        return name ? [{ node: path, name }] : [];
    }
    if (language === 'rust')
        return rustNames(child(node, 'argument') ?? node)
            .filter((item) => item.text !== '_')
            .map((item) => ({ node: item, name: item.text }));
    if (language === 'java' && !children(node).some((item) => item.text === '*')) {
        const name = descendants(node, 'identifier').at(-1);
        return name ? [{ node: name, name: name.text }] : [];
    }
    return [];
}
