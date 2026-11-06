import { z } from 'zod';
import { rangeSchema } from '../ast/schema.js';
import type { FileResult } from '../ast/schema.js';

export interface CollectionInput { file: FileResult; source: string }

const located = { id: z.string(), range: rangeSchema };
const owned = { ...located, functionId: z.string().nullable() };
export const syntaxEvidenceSchema = z.strictObject({
  scopes: z.array(z.strictObject({ ...located, parentId: z.string().nullable(),
    kind: z.enum(['module', 'global', 'function', 'block', 'class', 'static-block']) })),
  functions: z.array(z.strictObject({ ...located, name: z.string().nullable(), scopeId: z.string(),
    parentFunctionId: z.string().nullable(), bindingId: z.string().nullable(),
    async: z.boolean(), generator: z.boolean().nullable(), immediate: z.boolean().nullable(), hasBody: z.boolean() })),
  declarations: z.array(z.strictObject({ ...owned, name: z.string(), scopeId: z.string(),
    kind: z.enum(['const', 'let', 'var', 'parameter', 'function', 'class', 'import', 'catch', 'member', 'unknown']),
    initializer: z.string().nullable(), exported: z.boolean() })),
  references: z.array(z.strictObject({ ...owned, scopeId: z.string(), name: z.string(),
    targetId: z.string().nullable(), access: z.enum(['read', 'write', 'read-write']),
    property: z.string().nullable(), dynamicScope: z.boolean() })),
  calls: z.array(z.strictObject({ ...owned, callee: z.string(), targetId: z.string().nullable(), bindingId: z.string().nullable(),
    arguments: z.array(z.string()), kind: z.enum(['call', 'new']), loopIds: z.array(z.string()),
    resolution: z.enum(['lexical', 'unresolved']) })),
  loops: z.array(z.strictObject({ ...owned, parentLoopId: z.string().nullable(), kind: z.string(),
    initializer: z.string().nullable(), condition: z.string().nullable(), update: z.string().nullable(),
    iterable: z.string().nullable(), depth: z.int().positive() })),
  branches: z.array(z.strictObject({ ...owned, kind: z.string(), condition: z.string().nullable() })),
  exits: z.array(z.strictObject({ ...owned, kind: z.enum(['return', 'throw', 'break', 'continue', 'await', 'yield']),
    value: z.string().nullable(), enclosingLoopId: z.string().nullable() })),
  allocations: z.array(z.strictObject({ ...owned, kind: z.enum(['array', 'object', 'new', 'closure']),
    expression: z.string(), loopIds: z.array(z.string()) })),
  effects: z.array(z.strictObject({ ...owned, kind: z.enum(['this', 'super', 'delete', 'assignment', 'update', 'spread', 'tagged-call']),
    expression: z.string() })),
  imports: z.array(z.strictObject({ ...located, source: z.string(), dynamic: z.boolean() })),
  exports: z.array(z.strictObject({ ...located, name: z.string().nullable() })),
  coverage: z.strictObject({ level: z.enum(['structure', 'syntax']), complete: z.boolean(),
    limitations: z.array(z.string()) }),
});
export type SyntaxEvidence = z.infer<typeof syntaxEvidenceSchema>;
export type Declaration = SyntaxEvidence['declarations'][number];
export type Reference = SyntaxEvidence['references'][number];

export function emptyEvidence(): SyntaxEvidence {
  return { scopes: [], functions: [], declarations: [], references: [], calls: [], loops: [],
    branches: [], exits: [], allocations: [], effects: [], imports: [], exports: [],
    coverage: { level: 'structure', complete: false, limitations: [] } };
}
