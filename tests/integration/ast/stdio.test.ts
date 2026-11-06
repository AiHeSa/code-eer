import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { responseSchema } from '../../../services/code-review/internal/ast/protocol.js';
import { analysisSchema } from '../../../services/code-review/internal/ast/schema.js';
import { AstService } from '../../../services/code-review/internal/ast/service.js';

function stdio(messages: unknown[]): unknown[] {
  const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'),
    'services/cli/index.ts', 'serve'], { input: messages.map((message) => JSON.stringify(message)).join('\n') + '\n',
    encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n').map((line) => JSON.parse(line) as unknown);
}
test('stdio drains requests after input closes', () => {
  const response = responseSchema.parse(stdio([{ protocolVersion: '1.0', requestId: 'caps', backend: 'python',
    method: 'capabilities', params: {} }])[0]);
  assert.ok(response.ok);
  assert.equal(response.requestId, 'caps');
});
test('stdio identifies malformed JSON', () => {
  const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'),
    'services/cli/index.ts', 'serve'], { input: '{\n', encoding: 'utf8', timeout: 10000 });
  const response = responseSchema.parse(JSON.parse(result.stdout));
  assert.ok(!response.ok);
  assert.equal(response.error.code, 'INVALID_JSON');
});
test('stdio cancellation returns acknowledgement and cancelled analysis', () => {
  const responses = stdio([
    { protocolVersion: '1.0', requestId: 'work', backend: 'python', method: 'analyze',
      params: { root: resolve('tests/fixtures/ast'), files: ['python/sample.py'] } },
    { protocolVersion: '1.0', requestId: 'stop', method: 'cancel', targetRequestId: 'work' },
  ]).map((value) => responseSchema.parse(value));
  assert.equal(responses.length, 2);
  const result = responses.find((response) => response.requestId === 'work');
  assert.ok(result?.ok);
  assert.equal(analysisSchema.parse(result.result).status, 'cancelled');
});
test('a timed out real backend restarts on its next request', async () => {
  const service = new AstService();
  try {
    const failed = await service.dispatch({ protocolVersion: '1.0', requestId: 'early', backend: 'python',
      method: 'capabilities', params: {} }, { timeoutMs: 1 });
    assert.ok(!failed.ok);
    assert.equal(failed.error.code, 'TIMEOUT');
    assert.ok((await service.capabilities('python')).ok);
  } finally { service.close(); }
});
