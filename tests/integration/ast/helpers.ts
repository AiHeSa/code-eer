import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { analyzeParamsSchema } from '../../../services/code-review/internal/ast/protocol.js';
import { analysisSchema, type Analysis, type Language } from '../../../services/code-review/internal/ast/schema.js';

export const root = resolve('tests/fixtures/ast');
export async function analyze(service: AstService, backend: Language, files: string[],
  options: Record<string, unknown> = {}): Promise<Analysis> {
  const params = analyzeParamsSchema.parse({ root, files, ...options });
  const response = await service.analyze(backend, params);
  assert.ok(response.ok, JSON.stringify(response));
  return analysisSchema.parse(response.result);
}
export async function withFiles(files: Record<string, string>, run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'code-eer-'));
  try {
    for (const [name, source] of Object.entries(files)) {
      await mkdir(dirname(join(directory, name)), { recursive: true });
      await writeFile(join(directory, name), source);
    }
    await run(directory);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
