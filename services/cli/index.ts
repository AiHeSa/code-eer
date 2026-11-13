import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { AstService } from '../code-review/internal/ast/service.js';
import { languageSchema } from '../code-review/internal/ast/schema.js';
import { analyzeParamsSchema } from '../code-review/internal/ast/protocol.js';
import { serveStdio } from './stdio.js';

async function main(): Promise<void> {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            backend: { type: 'string' },
            root: { type: 'string' },
            framework: { type: 'string' },
            timeout: { type: 'string' },
            tsconfig: { type: 'string' },
            include: { type: 'string', multiple: true },
            exclude: { type: 'string', multiple: true },
            semantic: { type: 'boolean' },
            'no-tests': { type: 'boolean' },
        },
    });
    const [command, ...files] = positionals;
    if (command === 'serve') {
        serveStdio();
        return;
    }
    if (!['analyze', 'capabilities'].includes(command ?? '')) {
        console.log(
            'Usage: npm run dev -- <capabilities|analyze|serve> --backend <js-ts|python|java|go|rust> [--root path] [--semantic] [files...]',
        );
        return;
    }
    const service = new AstService();
    try {
        const backend = languageSchema.parse(values.backend);
        const timeoutMs = Number(values.timeout ?? 30000);
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Timeout must be positive');
        const params = analyzeParamsSchema.parse({
            root: resolve(values.root ?? process.cwd()),
            files,
            framework: values.framework,
            capabilities: values.semantic ? ['syntax', 'structure', 'symbols', 'types'] : undefined,
            include: values.include,
            exclude: values.exclude,
            tests: !values['no-tests'],
            config: values.tsconfig ? { tsconfig: values.tsconfig } : {},
        });
        const response =
            command === 'capabilities'
                ? await service.capabilities(backend)
                : await service.analyze(backend, params, { timeoutMs });
        console.log(JSON.stringify(response, null, 2));
        if (!response.ok || ('status' in response.result && response.result.status === 'failed')) process.exitCode = 1;
    } finally {
        service.close();
    }
}

void main().catch((error: unknown) => {
    console.error(String(error));
    process.exitCode = 1;
});
