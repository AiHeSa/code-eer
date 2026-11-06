import { z } from 'zod';
import type { AstService } from '../code-review/internal/ast/service.js';
import { analyzeParamsSchema, parseRequest } from '../code-review/internal/ast/protocol.js';
import { capabilitiesSchema, languageSchema } from '../code-review/internal/ast/schema.js';
import { collectAssessment } from '../code-review/internal/assessment/service.js';
import { assessmentConfigSchema } from '../code-review/internal/assessment/config.js';
import { HttpError } from './http.js';
import { evaluateAssessment } from '../code-review/internal/scoring/service.js';
import { evaluationInputSchema } from '../code-review/internal/scoring/config.js';

export interface ServiceContext { ast: AstService; root: string }
const collectRequest = z.strictObject({ backend: languageSchema,
  params: analyzeParamsSchema.omit({ root: true }).prefault({}), configuration: assessmentConfigSchema.prefault({}) });
const object = z.record(z.string(), z.unknown());
const evaluationRequest = evaluationInputSchema.omit({ root: true });

export async function health(context: ServiceContext) {
  const backends = await Promise.all(languageSchema.options.map(async (backend) => {
    const response = await context.ast.capabilities(backend);
    if (!response.ok) return { backend, available: false, error: response.error.code };
    const result = capabilitiesSchema.parse(response.result);
    return { backend, available: result.available, version: result.version,
      errors: result.errors.map((item) => item.code) };
  }));
  const ready = backends.filter((item) => ['js-ts', 'go'].includes(item.backend)).every((item) => item.available);
  return { ready, status: ready ? backends.every((item) => item.available) ? 'ready' : 'degraded' : 'unavailable',
    root: context.root, backends };
}

export async function dispatch(path: string, body: unknown, context: ServiceContext, signal: AbortSignal): Promise<unknown> {
  if (path === '/v1/assessments') return evaluateAssessment(context.ast, { ...evaluationRequest.parse(body), root: context.root }, { signal });
  if (path === '/v1/assessment/collect') {
    const input = collectRequest.parse(body);
    return collectAssessment(context.ast, input.backend, { ...input.params, root: context.root }, input.configuration, { signal });
  }
  if (path === '/v1/ast') {
    const input = object.parse(body);
    const params = input['method'] === 'analyze' ? object.parse(input['params']) : input['params'];
    if (input['method'] === 'analyze' && params && typeof params === 'object') {
      const options = params as Record<string, unknown>;
      if (options['root'] !== undefined && options['root'] !== context.root)
        throw new HttpError(400, 'ROOT_MISMATCH', 'Analysis root is fixed by the deployed service');
      input['params'] = { ...options, root: context.root };
    }
    return context.ast.dispatch(parseRequest(input), { signal });
  }
  throw new HttpError(404, 'NOT_FOUND', 'Unknown service endpoint');
}
