import { randomUUID } from 'node:crypto';
import { realpath, mkdir, writeFile, rename } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AstService } from '../ast/service.js';
import { languageSchema } from '../ast/schema.js';
import { analyzeParamsSchema, ProtocolError } from '../ast/protocol.js';
import { collectAssessment } from '../assessment/service.js';
import { evaluationInputSchema, type EvaluationInput } from './config.js';
import { loadPolicy, policySchema, type ScoringPolicy } from './policy.js';
import { snapshot, verifySnapshot, digest, gitHead, type SnapshotFile } from './snapshot.js';
import { deriveSemantics } from './semantics.js';
import type { ProjectFile } from './project.js';
import { evaluateProject } from './engine.js';
import { statistics } from './statistics.js';
import { grade } from './composite.js';
import { evaluationReportSchema, type EvaluationReport } from './report-model.js';

interface Options { signal?: AbortSignal; timeoutMs?: number; persist?: boolean; policy?: ScoringPolicy }
function checkpoint(options: Options, deadline: number): void {
  if (options.signal?.aborted) throw new ProtocolError('CANCELLED', 'Evaluation cancelled');
  if (Date.now() > deadline) throw new ProtocolError('TIMEOUT', 'Evaluation deadline exceeded');
}

async function collectProject(ast: AstService, input: EvaluationInput, sources: SnapshotFile[], options: Options, deadline: number) {
  const project: ProjectFile[] = sources.map((source) => ({ snapshot: source, collected: null, semantics: null, errors: [] }));
  const versions: Record<string, string> = {};
  for (const backend of languageSchema.options) {
    const members = project.filter((file) => file.snapshot.language === backend);
    if (!members.length) continue;
    checkpoint(options, deadline);
    try {
      const params = analyzeParamsSchema.parse({ root: input.root, files: members.map((file) => file.snapshot.path),
        include: input.include, exclude: input.exclude, tests: input.tests });
      const collection = await collectAssessment(ast, backend, params, { modules: input.configuration.modules },
        { timeoutMs: Math.max(1, deadline - Date.now()), ...(options.signal ? { signal: options.signal } : {}) });
      versions[backend] = collection.astVersion;
      for (const member of members) {
        member.collected = collection.files.find((file) => relative(input.root, fileURLToPath(file.uri)).split('\\').join('/') === member.snapshot.path) ?? null;
        if (!member.collected) member.errors.push(...collection.errors.map((error) => `${error.code}: ${error.message}`), 'No AST result for manifest member');
        else if (member.collected.digest !== member.snapshot.digest) throw new ProtocolError('SOURCE_CHANGED', member.snapshot.path);
        else if (!member.collected.evidence.coverage.complete) member.errors.push(...collection.diagnostics.filter((item) => item.file === member.collected!.uri).map((item) => item.message));
      }
    } catch (error) {
      if (error instanceof ProtocolError && ['SOURCE_CHANGED', 'CANCELLED', 'TIMEOUT'].includes(error.code)) throw error;
      for (const member of members) member.errors.push(String(error));
    }
  }
  for (const member of project) {
    checkpoint(options, deadline);
    if (member.collected && member.snapshot.language === 'js-ts') {
      try { member.semantics = await deriveSemantics(member.snapshot.path, member.snapshot.source); }
      catch (error) { member.errors.push(`Semantic extraction: ${String(error)}`); }
    }
  }
  return { project, versions };
}

async function persist(report: EvaluationReport, project: ProjectFile[]): Promise<void> {
  if (!report.artifacts) return;
  const directory = join(report.manifest.root, '.cache/assessments', report.runId);
  await mkdir(directory, { recursive: true });
  await writeFile(report.artifacts.evidence, JSON.stringify(project.map((file) => ({ path: file.snapshot.path,
    digest: file.snapshot.digest, collection: file.collected, errors: file.errors,
    derived: file.semantics ? {
      dependencies: file.semantics.dependencies.map((item) => ({ ...item, id: `${file.snapshot.path}#${item.id}` })),
      costs: [...file.semantics.costs].map(([id, cost]) => ({ id: `${file.snapshot.path}#${id}`, ...cost })),
      moduleCost: { id: `${file.snapshot.path}#module`, value: file.semantics.moduleCost },
      imports: [...file.semantics.imports], exports: [...file.semantics.exports],
      primitiveBindings: [...file.semantics.primitiveBindings], completeImports: file.semantics.completeImports,
    } : null }))) + '\n');
  await writeFile(report.artifacts.report + '.tmp', JSON.stringify(report, null, 2) + '\n');
  await rename(report.artifacts.report + '.tmp', report.artifacts.report);
}

export async function evaluateAssessment(ast: AstService, raw: unknown, options: Options = {}): Promise<EvaluationReport> {
  const input = evaluationInputSchema.parse(raw);
  input.root = await realpath(input.root);
  const policy = policySchema.parse(options.policy ?? await loadPolicy());
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 2147483647))
    throw new ProtocolError('INVALID_TIMEOUT', 'Evaluation timeout must be a positive 32-bit integer');
  const startedAt = new Date().toISOString(), deadline = Date.now() + (options.timeoutMs ?? 120000), runId = randomUUID();
  const sources = await snapshot(input), head = await gitHead(input.root);
  const { project, versions } = await collectProject(ast, input, sources, options, deadline);
  checkpoint(options, deadline);
  const evaluation = evaluateProject(project, policy, input.configuration);
  await verifySnapshot(input, sources); checkpoint(options, deadline);
  const directory = join(input.root, '.cache/assessments', runId);
  const report = evaluationReportSchema.parse({ schemaVersion: '1.0', engineVersion: 'scoring-engine-1', runId, source: 'internal',
    calibration: 'experimental-unvalidated', status: !project.some((file) => file.collected) ? 'failed'
      : evaluation.repository.composite.status === 'complete' ? 'complete' : 'partial', policy, configuration: input.configuration,
    manifest: { root: input.root, gitHead: head, sourceDigest: digest(JSON.stringify(sources.map(({ path, digest: hash }) => [path, hash]))),
      policyDigest: digest(JSON.stringify(policy)), configurationDigest: digest(JSON.stringify(input.configuration)),
      selection: { files: input.files, include: input.include, exclude: input.exclude, tests: input.tests },
      files: sources.map(({ path, language, digest: hash }) => ({ path, language, digest: hash })),
      parserVersions: versions, startedAt, completedAt: new Date().toISOString(), stable: true }, ...evaluation,
    grade: grade(evaluation.repository.composite, policy), statistics: statistics(project, evaluation, policy),
    errors: project.flatMap((file) => file.errors.map((error) => `${file.snapshot.path}: ${error}`)),
    artifacts: options.persist === false ? null : { report: join(directory, 'report.json'), evidence: join(directory, 'evidence.json') } });
  checkpoint(options, deadline); await persist(report, project); return report;
}
