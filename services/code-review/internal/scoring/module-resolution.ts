import { dirname, posix } from 'node:path';

export function resolveDependency(path: string, source: string, files: Set<string>): string | null {
    if (!source.startsWith('.')) return null;
    const base = posix.normalize(posix.join(dirname(path), source));
    if (base === '..' || base.startsWith('../')) return null;
    const stem = base.replace(/\.[cm]?js$/, '');
    const candidates = [
        base,
        ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.js'].map(
            (suffix) => stem + suffix,
        ),
    ];
    return candidates.find((candidate) => files.has(candidate)) ?? null;
}
