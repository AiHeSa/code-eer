import { defineCapability } from '../capabilities/contract.js';
import { rangeAt } from '../ast/normalize.js';
import { emptyEvidence, type SyntaxEvidence, type CollectionInput } from './model.js';

async function collect({ file, source }: CollectionInput): Promise<SyntaxEvidence> {
    const result = emptyEvidence();
    result.scopes.push({ id: 'module', parentId: null, kind: 'module', range: rangeAt(source, 0, source.length)! });
    const byId = new Map(file.facts.map((item) => [item.id, item]));
    const owner = (id: string | null): string | null => {
        while (id) {
            const item = byId.get(id);
            if (!item) return null;
            if (item.range && ['function', 'method', 'constructor'].includes(item.type)) return `ast:${id}`;
            id = item.parentId;
        }
        return null;
    };
    for (const fact of file.facts) {
        if (!fact.range) continue;
        const located = { id: `ast:${fact.id}`, range: fact.range };
        if (fact.type === 'import') result.imports.push({ ...located, source: fact.name ?? '', dynamic: false });
        if (fact.type === 'export') result.exports.push({ ...located, name: fact.name });
        if (!['function', 'method', 'constructor'].includes(fact.type)) continue;
        const parentFunctionId = owner(fact.parentId);
        const scopeId = `scope:${located.id}`;
        const bindingId = fact.name && fact.type === 'function' ? `binding:${located.id}` : null;
        if (bindingId)
            result.declarations.push({
                ...located,
                id: bindingId,
                name: fact.name!,
                kind: 'function',
                scopeId: parentFunctionId ? `scope:${parentFunctionId}` : 'module',
                functionId: parentFunctionId,
                initializer: null,
                exported: false,
            });
        result.scopes.push({
            id: scopeId,
            parentId: parentFunctionId ? `scope:${parentFunctionId}` : 'module',
            kind: 'function',
            range: fact.range,
        });
        result.functions.push({
            ...located,
            name: fact.name,
            scopeId,
            bindingId,
            parentFunctionId,
            async: 'async' in fact && fact.async,
            generator: null,
            immediate: bindingId ? false : null,
            hasBody: 'bodyRange' in fact && fact.bodyRange !== null,
        });
    }
    result.coverage.limitations = [
        'Only selected AST declarations and module facts are available',
        'Variables, references, calls, loops, branches and allocations need a language syntax collector',
        'Generator and anonymous immediate-invocation attributes are not evaluated',
    ];
    return result;
}

export default defineCapability({ collect });
