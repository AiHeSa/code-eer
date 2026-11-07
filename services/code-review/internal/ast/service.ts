import { BackendProcess, type Command } from './process.js';
import { failure, parseRequest, ProtocolError, type Request, type Response } from './protocol.js';
import { VERSION, type Language } from './schema.js';
import { randomUUID } from 'node:crypto';
import type { AnalyzeParams } from './protocol.js';
import { fileURLToPath } from 'node:url';

function workerCommand(language: Language): Command {
    const development = import.meta.url.endsWith('.ts');
    const file = new URL(`../../ast/server.${development ? 'ts' : 'js'}`, import.meta.url);
    const args = development ? ['--import', import.meta.resolve('tsx')] : [];
    return { command: process.execPath, args: [...args, fileURLToPath(file), language] };
}

export class AstService {
    private readonly processes = new Map<Language, BackendProcess>();

    constructor(private readonly commands: Partial<Record<Language, Command>> = {}) {}

    async dispatch(input: unknown, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<Response> {
        let request: Request;
        try {
            request = parseRequest(input);
        } catch (error) {
            return failure(null, error);
        }
        try {
            const timeoutMs = options.timeoutMs ?? 30000;
            if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647)
                throw new ProtocolError('INVALID_TIMEOUT', 'Timeout must be an integer from 1 to 2147483647ms');
            let backend = this.processes.get(request.backend);
            if (!backend) {
                backend = new BackendProcess(this.commands[request.backend] ?? workerCommand(request.backend));
                this.processes.set(request.backend, backend);
            }
            return await backend.request(request, timeoutMs, options.signal);
        } catch (error) {
            if (request.method === 'analyze' && error instanceof ProtocolError && error.code === 'CANCELLED')
                return {
                    protocolVersion: VERSION,
                    requestId: request.requestId,
                    ok: true,
                    result: {
                        schemaVersion: VERSION,
                        backend: request.backend,
                        version: 'unknown',
                        status: 'cancelled',
                        files: [],
                        findings: [],
                        configuration: JSON.parse(JSON.stringify(request.params)),
                        skipped: [],
                        errors: [{ code: 'CANCELLED', message: error.message, range: null }],
                    },
                };
            return failure(request.requestId, error);
        }
    }

    analyze(
        backend: Language,
        params: AnalyzeParams,
        options: { timeoutMs?: number; signal?: AbortSignal } = {},
    ): Promise<Response> {
        return this.dispatch(
            { protocolVersion: VERSION, requestId: randomUUID(), backend, method: 'analyze', params },
            options,
        );
    }

    capabilities(backend: Language): Promise<Response> {
        return this.dispatch({
            protocolVersion: VERSION,
            requestId: randomUUID(),
            backend,
            method: 'capabilities',
            params: {},
        });
    }

    close(): void {
        for (const backend of this.processes.values()) backend.close();
        this.processes.clear();
    }
}
