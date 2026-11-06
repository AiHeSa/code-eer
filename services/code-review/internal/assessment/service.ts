import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { realpath } from 'node:fs/promises';
import { AstService } from '../ast/service.js';
import { analyzeParamsSchema, ProtocolError, type AnalyzeParams } from '../ast/protocol.js';
import { analysisSchema, type FileResult, type Language } from '../ast/schema.js';
import { readSource } from '../ast/paths.js';
import collector from './collector.js';
import scriptCollector from './collector.js-ts.js';
import { syntaxEvidenceSchema } from './model.js';
import { assessmentConfigSchema } from './config.js';
import { analyzeScope } from './scope.js';
import { analyzeComplexity } from './complexity.js';
import { analyzePlacement } from './placement.js';

async function collectFile(root: string, file: FileResult, config: ReturnType<typeof assessmentConfigSchema.parse>) {
  if (file.errors.length || !file.executed.includes('structure'))
    throw new ProtocolError('NO_STRUCTURE', 'File has no usable AST structure');
  const input = await readSource(root, fileURLToPath(file.uri));
  if (createHash('sha256').update(input.source).digest('hex') !== file.digest)
    throw new ProtocolError('SOURCE_CHANGED', 'Source changed after AST analysis; retry against one snapshot');
  const capability = file.language === 'js-ts' ? scriptCollector : collector;
  const evidence = syntaxEvidenceSchema.parse(await capability.methods.collect({ file, source: input.source }));
  return { uri: file.uri, language: file.language, digest: file.digest, astFacts: file.facts, evidence,
    scope: analyzeScope(evidence), complexity: analyzeComplexity(evidence),
    placement: analyzePlacement(root, file, evidence, config), composite: { score: null, status: 'pending' as const } };
}

export async function collectAssessment(service: AstService, backend: Language, input: AnalyzeParams,
  configuration: unknown = {}, options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  const config = assessmentConfigSchema.parse(configuration);
  const root = await realpath(input.root);
  const params = analyzeParamsSchema.parse({ ...input, root, capabilities: ['syntax', 'structure', 'framework'], factTypes: undefined });
  // Framework is requested only for the JS/TS backend to avoid manufacturing unsupported results.
  if (backend !== 'js-ts') params.capabilities = ['syntax', 'structure'];
  else if (!params.framework) params.capabilities = ['syntax', 'structure'];
  const response = await service.analyze(backend, params, options);
  if (!response.ok) throw new ProtocolError(response.error.code, response.error.message);
  const analysis = analysisSchema.parse(response.result);
  const files: Awaited<ReturnType<typeof collectFile>>[] = [];
  const errors = [...analysis.errors];
  for (const file of analysis.files) {
    if (options.signal?.aborted) throw new ProtocolError('CANCELLED', 'Assessment collection cancelled');
    try { files.push(await collectFile(root, file, config)); }
    catch (error) { errors.push({ code: error instanceof ProtocolError ? error.code : 'COLLECTION_ERROR',
      file: file.uri, message: String(error), range: null }); }
  }
  return { schemaVersion: '1.0', phase: 'evidence', backend, root, configuration: config,
    astVersion: analysis.version, analysisConfiguration: analysis.configuration,
    configurationDigest: createHash('sha256').update(JSON.stringify(config)).digest('hex'),
    status: !files.length ? 'failed' : 'partial', astStatus: analysis.status,
    files, errors, skipped: [...analysis.skipped, ...analysis.files.flatMap((file) =>
      file.skipped.map((item) => ({ ...item, file: file.uri })))],
    diagnostics: analysis.files.flatMap((file) => file.diagnostics.map((item) => ({ ...item, file: file.uri }))) };
}
