import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { relative } from 'node:path';
import { discover, readSource } from '../ast/paths.js';
import { analyzeParamsSchema, ProtocolError } from '../ast/protocol.js';
import { languageSchema, type Language } from '../ast/schema.js';
import type { EvaluationInput } from './config.js';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export interface SnapshotFile {
    path: string;
    language: Language;
    digest: string;
    source: string;
}

export async function snapshot(input: EvaluationInput): Promise<SnapshotFile[]> {
    const params = analyzeParamsSchema.parse({
        root: input.root,
        files: input.files,
        include: input.include,
        exclude: input.exclude,
        tests: input.tests,
    });
    const files = new Map<string, Language>();
    if (input.files.length) {
        const { languageFor, included } = await import('../ast/paths.js');
        for (const path of input.files) {
            const source = await readSource(input.root, path),
                language = languageFor(source.path);
            if (language && included(relative(input.root, source.path), params)) files.set(source.path, language);
        }
    } else
        for (const language of languageSchema.options)
            for (const path of await discover(params, language)) files.set(path, language);
    const result: SnapshotFile[] = [];
    for (const [path, language] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
        const source = await readSource(input.root, path);
        result.push({
            path: relative(input.root, source.path).split('\\').join('/'),
            language,
            source: source.source,
            digest: digest(source.source),
        });
    }
    return result;
}

/** 同时复核清单和内容，新增、删除或修改源码都会使本次评估失效。 */
export async function verifySnapshot(input: EvaluationInput, before: SnapshotFile[]): Promise<void> {
    const after = await snapshot(input);
    const summarize = (files: SnapshotFile[]) => files.map(({ path, digest: hash }) => [path, hash]);
    if (JSON.stringify(summarize(before)) !== JSON.stringify(summarize(after)))
        throw new ProtocolError('SOURCE_CHANGED', 'Repository source manifest changed during evaluation');
}

export async function gitHead(root: string): Promise<string | null> {
    try {
        return (await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    } catch {
        return null;
    }
}
