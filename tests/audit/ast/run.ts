import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { compileTemplate } from '@vue/compiler-sfc';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { analyzeParamsSchema } from '../../../services/code-review/internal/ast/protocol.js';
import { analysisSchema } from '../../../services/code-review/internal/ast/schema.js';
import { languageCases } from './languages.js';
import { frameworkCases } from './frameworks.js';
import { controls, planned } from './controls.js';
import { check } from './checks.js';
import type { AuditCase } from './model.js';

async function runCase(service: AstService, probe: AuditCase) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'code-eer-audit-')));
  try {
    for (const [name, source] of Object.entries(probe.files)) {
      await mkdir(dirname(join(root, name)), { recursive: true });
      await writeFile(join(root, name), source);
    }
    const params = analyzeParamsSchema.parse({ root, files: probe.entry, ...probe.params });
    const response = await service.analyze(probe.backend, params);
    if (!response.ok) return { ...probe, status: 'error', failures: [response.error], response };
    const result = analysisSchema.parse(response.result);
    const failures = probe.expects.flatMap((expected) => check(result, expected, root));
    const errors = [...result.errors, ...result.files.flatMap((file) => file.errors)];
    const oracle = probe.templateOracle === undefined ? undefined : compileTemplate({
      source: probe.templateOracle, filename: 'View.vue', id: 'audit',
    }).errors.map((error) => typeof error === 'string' ? error : { code: error.code, message: error.message });
    if (oracle && !oracle.length) throw new Error(`Native compiler did not reject ${probe.id}`);
    return { ...probe, status: errors.length ? 'error' : failures.length ? 'missing' : 'passed', failures, oracle, result };
  } catch (error) { return { ...probe, status: 'error', failures: [String(error)] }; }
  finally { await rm(root, { recursive: true, force: true }); }
}

const service = new AstService();
const path = resolve('.cache/verification/ast-completeness.json');
const cases = [];
await mkdir(dirname(path), { recursive: true });
await writeFile(path, JSON.stringify({ status: 'running', startedAt: new Date().toISOString() }) + '\n');
try {
  const capabilities = await Promise.all(['js-ts', 'python', 'java', 'go', 'rust'].map((backend) =>
    service.capabilities(backend as AuditCase['backend'])));
  for (const probe of [...controls, ...languageCases, ...frameworkCases, ...planned]) {
    const result = await runCase(service, probe);
    cases.push(result);
    console.log(`${result.status.toUpperCase()} ${probe.id}: ${probe.title}`);
  }
  const baseline = cases.filter((entry) => entry.scope === 'baseline');
  const status = cases.some((entry) => entry.status === 'error'
    || entry.id.startsWith('CONTROL-') && entry.status !== 'passed') ? 'error'
    : baseline.some((entry) => entry.status !== 'passed') ? 'incomplete' : 'baseline-probes-passed';
  const fingerprint = createHash('sha256').update(JSON.stringify(cases.map(({ id, files }) => ({ id, files })))).digest('hex');
  const sources = [...new Set([...cases.flatMap((entry) => entry.implementation),
    'services/code-review/internal/ast/schema.ts', 'services/code-review/internal/ast/extensions.ts',
    'services/code-review/internal/ast/coverage.ts', 'services/code-review/internal/ast/coverage-schema.ts',
    'services/code-review/internal/ast/normalize.ts', 'services/code-review/internal/ast/worker-analysis.ts',
    'services/code-review/ast/js-ts/scope.ts', 'services/code-review/ast/js-ts/commonjs.ts',
    'services/code-review/ast/js-ts/exports.ts', 'services/code-review/ast/js-ts/project-files.ts',
    'services/code-review/ast/js-ts/framework-project.ts', 'services/code-review/ast/js-ts/react-components.ts',
    'services/code-review/ast/js-ts/vue-options.ts', 'services/code-review/ast/python/metadata.py',
    'package-lock.json', 'services/code-review/ast/rust/Cargo.lock'])];
  const implementationDigests = Object.fromEntries(await Promise.all(sources.map(async (source) =>
    [source, createHash('sha256').update(await readFile(resolve(source))).digest('hex')])));
  await writeFile(path, JSON.stringify({ status, checkedAt: new Date().toISOString(), node: process.version,
    mode: import.meta.url.endsWith('.js') ? 'compiled' : 'source', fingerprint, implementationDigests, capabilities,
    summary: { baseline: baseline.length, baselinePassed: baseline.filter((entry) => entry.status === 'passed').length,
      baselineMissing: baseline.filter((entry) => entry.status === 'missing').length,
      plannedMissing: cases.filter((entry) => entry.scope === 'planned' && entry.status === 'missing').length,
      errors: cases.filter((entry) => entry.status === 'error').length }, cases }, null, 2) + '\n');
  console.log(`Audit status: ${status}; report: ${path}`);
  process.exitCode = status === 'error' ? 2 : status === 'incomplete' ? 1 : 0;
} finally { service.close(); }
