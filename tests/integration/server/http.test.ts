import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { createReviewServer } from '../../../services/server/server.js';
import { withFiles } from '../ast/helpers.js';

async function withServer(run: (url: string, root: string) => Promise<void>): Promise<void> {
  await withFiles({ 'sample.ts': 'export function leaf(x: number) { return x + 1; }',
    'main.go': 'package main\nfunc Load() int { return 1 }' }, async (root) => {
    const ast = new AstService();
    const server = createReviewServer({ root, ast });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    try { await run(`http://127.0.0.1:${address.port}`, root); }
    finally { ast.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
}

async function post(url: string, path: string, body: unknown) {
  return fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

test('HTTP: health exposes actual Go backend readiness and keeps optional backends explicit', async () => {
  await withServer(async (url) => {
    const response = await fetch(`${url}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ready, true);
    assert.equal(body.backends.find((item: { backend: string }) => item.backend === 'go').available, true);
    assert.equal(body.backends.length, 5);
  });
});

test('HTTP: real Go analysis uses the deployed project root', async () => {
  await withServer(async (url) => {
    const response = await post(url, '/v1/ast', { protocolVersion: '1.0', requestId: 'go-http', backend: 'go',
      method: 'analyze', params: { files: ['main.go'] } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.result.status, 'complete');
    assert.ok(body.result.files[0].facts.some((item: { name: string }) => item.name === 'Load'));
  });
});

test('HTTP: evidence collection stays a service capability and does not fabricate scores', async () => {
  await withServer(async (url) => {
    const response = await post(url, '/v1/assessment/collect', { backend: 'js-ts', params: { files: ['sample.ts'] } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.files[0].evidence.functions[0].name, 'leaf');
    assert.equal(body.files[0].scope.score, null);
    assert.equal(body.files[0].composite.status, 'pending');
  });
});

test('HTTP: scoring evaluates the fixed root and returns a persisted experimental report', async () => {
  await withServer(async (url) => {
    const response = await post(url, '/v1/assessments', { files: ['sample.ts'] });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.engineVersion, 'scoring-engine-4');
    assert.equal(body.calibration, 'experimental-unvalidated');
    assert.equal(body.files.length, 1);
    assert.ok(body.artifacts.report.endsWith('/report.json'));
    assert.equal(body.grade.value, null);
    assert.equal((await post(url, '/v1/assessments', { root: '/other/project' })).status, 400);
  });
});

test('HTTP: invalid input, cross-origin access and root replacement are rejected', async () => {
  await withServer(async (url) => {
    assert.equal((await fetch(`${url}/missing`)).status, 404);
    assert.equal((await fetch(`${url}/v1/ast`)).status, 405);
    assert.equal((await fetch(`${url}/v1/ast`, { method: 'POST', body: '{}' })).status, 415);
    const invalid = await fetch(`${url}/v1/ast`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(invalid.status, 400);
    const origin = await fetch(`${url}/health`, { headers: { Origin: 'https://unrelated.example' } });
    assert.equal(origin.status, 403);
    const root = await post(url, '/v1/ast', { protocolVersion: '1.0', requestId: 'root', backend: 'go',
      method: 'analyze', params: { root: '/other/project', files: [] } });
    assert.equal(root.status, 400);
    assert.equal((await root.json()).error.code, 'ROOT_MISMATCH');
    const schema = await post(url, '/v1/assessment/collect', { backend: 'go', unexpected: true });
    assert.equal(schema.status, 400);
  });
});
