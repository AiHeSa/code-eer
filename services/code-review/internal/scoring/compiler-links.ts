import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';
import type { ProjectFile } from './project.js';
import type { SyntaxEvidence } from '../assessment/model.js';
import type { Range } from '../ast/schema.js';
import { semanticId } from '../ast/semantic-schema.js';

const before = (a: Range['start'], b: Range['start']) => a.line < b.line || a.line === b.line && a.character <= b.character;
const overlaps = (a: Range, b: Range) => before(a.start, b.end) && before(b.start, a.end);
export function compilerLinks(files: ProjectFile[]) {
  const byUri = new Map(files.filter((file) => file.collected).map((file) => [file.collected!.uri, file]));
  const writes = new Set(files.flatMap((file) => file.collected?.evidence.effects.flatMap((effect) => effect.targetRange
    ? file.collected!.semantic?.references.filter((ref) => ref.definition && before(effect.targetRange!.start, ref.range.start)
      && before(ref.range.end, effect.targetRange!.end)).flatMap((ref) => semanticId(ref.definition!)) ?? [] : []) ?? []));
  return (file: ProjectFile, call: SyntaxEvidence['calls'][number]): string | null => {
    if (call.kind !== 'call' || file.snapshot.language === 'js-ts') return null;
    const refs = file.collected?.semantic?.references.filter((ref) => ref.definition && overlaps(ref.range, call.calleeRange ?? call.range)
      && (call.callee === ref.name || call.callee.endsWith(`.${ref.name}`) || call.callee.endsWith(`::${ref.name}`))) ?? [];
    const targets = refs.flatMap((ref) => {
      const target = byUri.get(ref.definition!.uri);
      if (!target) return [];
      const fn = target.collected!.evidence.functions.filter((fn) => fn.hasBody && before(fn.range.start, ref.definition!.range.start)
        && target.collected!.evidence.declarations.some((binding) => binding.id === fn.bindingId && overlaps(binding.range, ref.definition!.range))
        && before(ref.definition!.range.end, fn.range.end)).sort((a, b) => (a.range.end.line - a.range.start.line) - (b.range.end.line - b.range.start.line)
          || (a.range.end.character - a.range.start.character) - (b.range.end.character - b.range.start.character))[0];
      if (!fn || fn.dispatch === 'virtual') return [];
      if (writes.has(semanticId(ref.definition!))) return [];
      const rewritten = target.collected!.evidence.references.some((item) => item.targetId === fn.bindingId && item.property === null && item.access !== 'read');
      return rewritten ? [] : [`${target.snapshot.path}#${fn.id}`];
    });
    return targets.length && targets.every((target) => target === targets[0]) ? targets[0]! : null;
  };
}
