import { basename, dirname, extname, posix } from 'node:path';

export function readTargets(source) {
    const targets = JSON.parse(source);
    if (!targets || !Array.isArray(targets.languages) || !Array.isArray(targets.frameworks))
        throw new Error('Capability target configuration must declare languages and frameworks');
    const names = [...targets.languages, ...targets.frameworks];
    if (
        names.some((name) => typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name)) ||
        new Set(names).size !== names.length
    )
        throw new Error('Invalid or duplicate capability targets');
    return new Set(names);
}

export function capabilityFamilies(files, targets) {
    const families = new Map();
    for (const [path, source] of files) {
        if (path.startsWith('tests/') || path.startsWith('.idea/') || /\.d\.[cm]?ts$/.test(path)) continue;
        const extension = extname(path);
        const stem = basename(path, extension);
        const separator = stem.lastIndexOf('.');
        if (separator < 0) continue;
        const target = stem.slice(separator + 1);
        const common = posix.join(dirname(path), stem.slice(0, separator) + extension);
        if (
            !targets.has(target) &&
            (!files.has(common) ||
                ![
                    '.ts',
                    '.js',
                    '.tsx',
                    '.jsx',
                    '.mts',
                    '.cts',
                    '.mjs',
                    '.cjs',
                    '.md',
                    '.java',
                    '.py',
                    '.go',
                    '.rs',
                ].includes(extension))
        )
            continue;
        if (!targets.has(target)) throw new Error(`${path}: unregistered capability target ${target}`);
        if (source === null) throw new Error(`${path}: capability files must be regular files`);
        if (!files.has(common) || files.get(common) === null)
            throw new Error(`${path}: missing common capability ${common}`);
        if (basename(common, extension).includes('.'))
            throw new Error(`${path}: common capability must have a single base name`);
        if (!families.has(common)) families.set(common, []);
        families.get(common).push({ path, target });
    }
    return families;
}
