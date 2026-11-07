import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { rangeAt } from './normalize.js';
import { semanticSchema, semanticId, type SemanticResult, type SemanticLocation } from './semantic-schema.js';
import { nativeCommand } from '../../ast/native-parsers.js';
import type { AnalyzeParams } from './protocol.js';

const rawLocation = z.object({ path: z.string(), start: z.number(), end: z.number() });
const rawSchema = z.object({
    provider: z.string(),
    version: z.string(),
    status: z.enum(['complete', 'partial', 'failed']),
    encoding: z.enum(['utf8', 'utf16']),
    references: z.array(
        rawLocation.extend({
            name: z.string(),
            declaration: z.boolean(),
            definition: rawLocation.nullable(),
            targetId: z.string().nullish(),
            type: z.string().nullable(),
        }),
    ),
    diagnostics: z.array(z.object({ message: z.string(), severity: z.enum(['error', 'warning', 'info']) })),
    limitations: z.array(z.string()),
    imports: z
        .array(
            z.object({
                source: z.string(),
                resolved: z.boolean(),
                paths: z.array(z.string()).nullable(),
                name: z.string().optional(),
            }),
        )
        .default([]),
});

function exchange(command: string, args: string[], input: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: 'pipe' }),
            chunks: Buffer[] = [];
        let bytes = 0,
            error = '';
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error('Semantic compiler timed out'));
        }, 90000);
        child.stdout.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 16 * 1024 * 1024) child.kill();
            else chunks.push(chunk);
        });
        child.stderr.on('data', (chunk: Buffer) => {
            error = (error + chunk).slice(-8192);
        });
        child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code) reject(new Error(error));
            else {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                } catch (err) {
                    reject(err);
                }
            }
        });
        child.stdin.on('error', reject);
        child.stdin.end(JSON.stringify(input));
    });
}

export async function nativeSemantics(
    language: 'java' | 'go',
    path: string,
    source: string,
    params: AnalyzeParams,
): Promise<SemanticResult> {
    const command = nativeCommand(language);
    const args =
        language === 'java' ? command.args.map((arg) => (arg === 'eer.Main' ? 'eer.SemanticMain' : arg)) : command.args;
    const raw = rawSchema.parse(
        await exchange(command.command, args, { path, source, root: params.root, semantic: true }),
    );
    const sources = new Map<string, string>([[path, source]]);
    const locate = async (value: z.infer<typeof rawLocation>): Promise<SemanticLocation | null> => {
        if (!sources.has(value.path))
            try {
                sources.set(value.path, await readFile(value.path, 'utf8'));
            } catch {
                return null;
            }
        const range = rangeAt(sources.get(value.path)!, value.start, value.end, raw.encoding);
        return range ? { uri: pathToFileURL(value.path).href, range } : null;
    };
    const references: SemanticResult['references'] = [],
        symbols = new Map<string, SemanticResult['symbols'][number]>();
    for (const item of raw.references) {
        const own = await locate(item);
        if (!own) continue;
        const definition = item.definition ? await locate(item.definition) : null;
        const targetId = definition ? semanticId(definition) : item.targetId || null;
        references.push({
            name: item.name,
            range: own.range,
            declaration: item.declaration,
            definition,
            targetId,
            type: item.type,
        });
        if (item.declaration && definition && targetId)
            symbols.set(targetId, {
                id: targetId,
                name: item.name,
                kind: 'compiler-symbol',
                range: own.range,
                definition,
                type: item.type,
            });
    }
    return semanticSchema.parse({
        provider: raw.provider,
        version: raw.version,
        status: raw.status,
        limitations: raw.limitations,
        imports: raw.imports.map((item) => ({
            source: item.source,
            resolved: item.resolved,
            uris: (item.paths ?? []).map((path) => pathToFileURL(path).href),
            ...(item.name ? { name: item.name } : {}),
        })),
        symbols: [...symbols.values()],
        references,
        diagnostics: raw.diagnostics.map((item) => ({ ...item, range: null })),
    });
}
