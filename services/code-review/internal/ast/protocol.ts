import { z } from 'zod';
import { isAbsolute } from 'node:path';
import { VERSION, analysisSchema, capabilitiesSchema, capabilitySchema, factTypeSchema, languageSchema } from './schema.js';

export const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
export const analyzeParamsSchema = z.strictObject({
  root: z.string().min(1).refine(isAbsolute, 'Project root must be absolute'),
  files: z.array(z.string()).max(10000).default([]),
  capabilities: z.array(capabilitySchema).min(1).default(['syntax', 'structure']),
  factTypes: z.array(factTypeSchema).optional(), framework: z.enum(['react', 'vue']).optional(),
  include: z.array(z.string()).default(['**/*']), exclude: z.array(z.string()).default([]),
  tests: z.boolean().default(true),
  config: z.strictObject({ tsconfig: z.string().optional(), pythonVersion: z.int().optional(),
    javaLanguageLevel: z.string().optional(), rustEdition: z.enum(['2015', '2018', '2021', '2024']).optional() }).default({}),
});
const header = { protocolVersion: z.literal(VERSION), requestId: z.string().min(1).max(128), backend: languageSchema };
export const requestSchema = z.discriminatedUnion('method', [
  z.strictObject({ ...header, method: z.literal('capabilities'), params: z.strictObject({}) }),
  z.strictObject({ ...header, method: z.literal('analyze'), params: analyzeParamsSchema }),
]);
export const responseSchema = z.union([
  z.strictObject({ protocolVersion: z.literal(VERSION), requestId: z.string(), ok: z.literal(true),
    result: z.union([analysisSchema, capabilitiesSchema, z.strictObject({ cancelled: z.boolean() })]) }),
  z.strictObject({ protocolVersion: z.literal(VERSION), requestId: z.string().nullable(), ok: z.literal(false),
    error: z.strictObject({ code: z.string(), message: z.string() }) }),
]);
export const cancelSchema = z.strictObject({ protocolVersion: z.literal(VERSION),
  requestId: z.string().min(1), method: z.literal('cancel'), targetRequestId: z.string().min(1) });
export type Request = z.infer<typeof requestSchema>;
export type Response = z.infer<typeof responseSchema>;
export type AnalyzeParams = z.infer<typeof analyzeParamsSchema>;
export class ProtocolError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
export function parseRequest(input: unknown): Request {
  if (typeof input === 'object' && input && 'protocolVersion' in input && input.protocolVersion !== VERSION)
    throw new ProtocolError('UNSUPPORTED_PROTOCOL', String(input.protocolVersion));
  const result = requestSchema.safeParse(input);
  if (!result.success) throw new ProtocolError('INVALID_REQUEST', result.error.message);
  return result.data;
}
export function failure(requestId: string | null, error: unknown): Response {
  return { protocolVersion: VERSION, requestId, ok: false, error: {
    code: error instanceof ProtocolError ? error.code : error instanceof SyntaxError ? 'INVALID_JSON' : 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : String(error),
  } };
}
