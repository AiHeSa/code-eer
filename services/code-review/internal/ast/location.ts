import { z } from 'zod';

export const positionSchema = z.strictObject({ line: z.int().nonnegative(), character: z.int().nonnegative() });
export const rangeSchema = z.strictObject({ start: positionSchema, end: positionSchema }).refine(
  ({ start, end }) => start.line < end.line || start.line === end.line && start.character <= end.character,
  'Range end precedes start');
