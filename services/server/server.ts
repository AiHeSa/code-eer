import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import { ProtocolError } from '../code-review/internal/ast/protocol.js';
import { checkLocalRequest, HttpError, readJson, sendJson } from './http.js';
import { dispatch, health, type ServiceContext } from './routes.js';

async function handle(request: IncomingMessage, response: ServerResponse, context: ServiceContext): Promise<void> {
  checkLocalRequest(request);
  if (request.method === 'GET' && request.url === '/health') {
    const result = await health(context);
    sendJson(response, result.ready ? 200 : 503, result); return;
  }
  if (!['/v1/ast', '/v1/assessment/collect', '/v1/assessments'].includes(request.url ?? ''))
    throw new HttpError(404, 'NOT_FOUND', 'Unknown service endpoint');
  if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST');
  const controller = new AbortController();
  const abort = () => { if (!response.writableEnded) controller.abort(); };
  response.once('close', abort);
  try {
    const result = await dispatch(request.url!, await readJson(request), context, controller.signal);
    sendJson(response, 200, result);
  } finally { response.removeListener('close', abort); }
}

function failure(response: ServerResponse, error: unknown): void {
  const status = error instanceof HttpError ? error.status : error instanceof ZodError || error instanceof ProtocolError ? 400 : 500;
  const code = error instanceof HttpError || error instanceof ProtocolError ? error.code
    : error instanceof ZodError ? 'INVALID_REQUEST' : 'INTERNAL_ERROR';
  sendJson(response, status, { ok: false, error: { code, message: error instanceof Error ? error.message : String(error) } });
}

export function createReviewServer(context: ServiceContext) {
  let active = 0;
  return createServer({ requestTimeout: 30000, headersTimeout: 10000 }, (request, response) => {
    if (active >= 8) { failure(response, new HttpError(503, 'BUSY', 'At most 8 active requests')); return; }
    active++;
    void handle(request, response, context).catch((error: unknown) => failure(response, error))
      .finally(() => { active--; });
  });
}
