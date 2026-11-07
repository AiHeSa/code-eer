import { API } from 'typescript/async';
import { extname, resolve } from 'node:path';
import { capabilityFamilies, readTargets } from './families.mjs';
import { codeMethods } from './code.mjs';
import {
    parseCapabilityDocument,
    validateDocumentInheritance,
} from '../../services/code-review/internal/capabilities/document.ts';

export async function checkInheritance(files) {
    const config = files.get('config/capability-targets.json');
    if (!config) throw new Error('Missing config/capability-targets.json');
    const families = capabilityFamilies(files, readTargets(config));
    const failures = [];
    let specializations = 0;
    await using api = new API();
    const methods = async (path, common) => {
        const source = files.get(path);
        if (extname(path) === '.md') {
            const document = parseCapabilityDocument(path, source);
            if (common) validateDocumentInheritance(parseCapabilityDocument(common, files.get(common)), document);
            else if (document.extends !== null) throw new Error(`${path}: common document must be a root definition`);
            return [...document.entries.keys()];
        }
        if (!['.ts', '.js', '.tsx', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].includes(extname(path)))
            throw new Error(`${path}: inheritance validator required for ${extname(path)} implementations`);
        await using lease = await api.createSourceFile(resolve(path), source);
        return codeMethods(lease.sourceFile, path, common);
    };
    for (const [common, variants] of families) {
        try {
            const allowed = new Set(await methods(common));
            for (const variant of variants) {
                specializations++;
                try {
                    const extra = (await methods(variant.path, common)).filter((name) => !allowed.has(name));
                    if (extra.length) throw new Error(`${variant.path}: unknown common entries: ${extra.join(', ')}`);
                } catch (error) {
                    failures.push(error.message);
                }
            }
        } catch (error) {
            failures.push(error.message);
        }
    }
    if (failures.length) throw new Error(failures.join('\n'));
    return {
        families: families.size,
        specializations,
        roots: [...families]
            .flatMap(([common, variants]) => [common, ...variants.map((variant) => variant.path)])
            .filter((path) => extname(path) !== '.md'),
    };
}
