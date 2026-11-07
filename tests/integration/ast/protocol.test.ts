import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { BackendProcess } from '../../../services/code-review/internal/ast/process.js';
import { ProtocolError, requestSchema, type Request } from '../../../services/code-review/internal/ast/protocol.js';
import { capabilitiesSchema } from '../../../services/code-review/internal/ast/schema.js';

const request: Request = requestSchema.parse({
    protocolVersion: '1.0',
    requestId: 'test',
    backend: 'python',
    method: 'capabilities',
    params: {},
});
const fake = (mode: string) =>
    new BackendProcess({ command: process.execPath, args: [resolve('tests/fixtures/protocol/worker.mjs'), mode] });

for (const [mode, code] of [
    ['malformed', 'INVALID_RESPONSE'],
    ['invalid', 'INVALID_RESPONSE'],
    ['mismatch', 'RESPONSE_MISMATCH'],
    ['exit', 'BACKEND_EXIT'],
    ['oversized', 'MESSAGE_TOO_LARGE'],
]) {
    test(`protocol rejects ${mode} backend output`, async () => {
        const backend = fake(mode!);
        try {
            await assert.rejects(
                backend.request(request, 5000),
                (error: unknown) => error instanceof ProtocolError && error.code === code,
            );
        } finally {
            backend.close();
        }
    });
}

test('fragmented frames preserve response correlation and queued requests', async () => {
    const backend = fake('fragment');
    try {
        const responses = await Promise.all(
            Array.from({ length: 10 }, (_, index) => backend.request({ ...request, requestId: String(index) }, 3000)),
        );
        assert.deepEqual(
            responses.map((response) => response.requestId),
            Array.from({ length: 10 }, (_, i) => String(i)),
        );
    } finally {
        backend.close();
    }
});

test('timeout and cancellation permit a subsequent process restart', async () => {
    const backend = fake('hang');
    try {
        await assert.rejects(
            backend.request(request, 80),
            (error: unknown) => error instanceof ProtocolError && error.code === 'TIMEOUT',
        );
        const controller = new AbortController();
        const pending = backend.request(request, 3000, controller.signal);
        setTimeout(() => controller.abort(), 40);
        await assert.rejects(pending, (error: unknown) => error instanceof ProtocolError && error.code === 'CANCELLED');
    } finally {
        backend.close();
    }
    const healthy = fake('fragment');
    try {
        assert.ok((await healthy.request(request, 3000)).ok);
    } finally {
        healthy.close();
    }
});

test('one unavailable backend does not block a real language parser', async () => {
    const service = new AstService({ java: { command: '/missing/code-eer-backend', args: [] } });
    try {
        const broken = await service.capabilities('java');
        assert.equal(broken.ok, false);
        const healthy = await service.capabilities('python');
        assert.ok(healthy.ok);
        assert.equal(capabilitiesSchema.parse(healthy.result).available, true);
    } finally {
        service.close();
    }
});

test('protocol versions, unknown fields and empty capabilities are validated', async () => {
    const service = new AstService();
    try {
        const version = await service.dispatch({ ...request, protocolVersion: '2.0' });
        assert.ok(!version.ok);
        assert.equal(version.error.code, 'UNSUPPORTED_PROTOCOL');
        assert.equal((await service.dispatch({ ...request, surprise: true })).ok, false);
        assert.equal(
            (await service.dispatch({ ...request, method: 'analyze', params: { root: '/', capabilities: [] } })).ok,
            false,
        );
    } finally {
        service.close();
    }
});
