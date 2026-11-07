import type { ProjectFile } from './project.js';
import type { BindingReference } from './semantic-links.js';
import { resolveDependency } from './module-resolution.js';
import type { SyntaxEvidence } from '../assessment/model.js';

const absent = Symbol('Known absent ESM export');
type Resolution = string | null | typeof absent;

function stable(file: ProjectFile, bindingId: string) {
  const evidence = file.collected?.evidence;
  return Boolean(evidence?.coverage.complete && !evidence.references.some((ref) => ref.dynamicScope
    || ref.targetId === bindingId && ref.property === null && ref.access !== 'read'));
}
function objectClosed(file: ProjectFile, bindingId: string) {
  const evidence = file.collected!.evidence;
  return evidence.references.filter((ref) => ref.targetId === bindingId).every((ref) => ref.property !== null && ref.access === 'read'
    && evidence.calls.some((call) => call.callee === ref.property && call.range.start.line === ref.range.start.line
      && call.range.start.character === ref.range.start.character));
}

class LinkResolver {
  private byPath: Map<string, ProjectFile>;
  private paths: Set<string>;
  constructor(files: ProjectFile[]) { this.byPath = new Map(files.map((file) => [file.snapshot.path, file])); this.paths = new Set(this.byPath.keys()); }
  private exported(path: string, names: string[], seen: Set<string>): Resolution {
    const file = this.byPath.get(path), semantics = file?.semantics, name = names[0];
    const key = `export:${path}:${names.join('.')}`;
    if (!file || !semantics || !name || seen.has(key)) return null;
    const next = new Set([...seen, key]), direct = semantics.exports.get(name);
    if (direct && names.length === 1) {
      const bindingId = file.collected?.evidence.functions.find((fn) => fn.id === direct)?.bindingId;
      return !bindingId || stable(file, bindingId) ? `${path}#${direct}` : null;
    }
    const binding = semantics.links.exportBindings.get(name);
    if (binding) return this.resolve(file, { ...binding, members: [...binding.members, ...names.slice(1)] }, next);
    const explicit = semantics.links.reexports.filter((item) => item.name === name);
    const links = explicit.length ? explicit : name === 'default' ? [] : semantics.links.reexports.filter((item) => item.name === '*');
    const targets = links.map((item) => {
      const target = resolveDependency(path, item.source, this.paths);
      const members = item.imported === '*' ? item.name === '*' ? names : names.slice(1) : [item.imported, ...names.slice(1)];
      return target ? this.exported(target, members, next) : null;
    });
    if (targets.some((target) => target === null)) return null;
    const present = targets.filter((target) => target !== absent);
    return present.length ? present.every((target) => target === present[0]) ? present[0]! : null
      : explicit.length ? null : semantics.exportsComplete ? absent : null;
  }
  private resolve(file: ProjectFile, ref: BindingReference, seen = new Set<string>()): string | null {
    const path = file.snapshot.path, key = `${path}:${ref.bindingId}:${ref.members.join('.')}`;
    if (!stable(file, ref.bindingId) || seen.has(key)) return null;
    const next = new Set([...seen, key]), evidence = file.collected!.evidence, links = file.semantics?.links;
    const alias = links?.aliases.get(ref.bindingId);
    if (alias) return this.resolve(file, { ...alias, members: [...alias.members, ...ref.members] }, next);
    const namespace = links?.namespaces.get(ref.bindingId), imported = file.semantics?.imports.get(ref.bindingId);
    if (namespace || imported) {
      const target = resolveDependency(path, namespace ?? imported!.source, this.paths);
      const result = target ? this.exported(target, namespace ? ref.members : [imported!.imported, ...ref.members], next) : null;
      return typeof result === 'string' ? result : null;
    }
    const method = ref.members.length === 1 && links?.objects.get(ref.bindingId)?.get(ref.members[0]!);
    if (method) return objectClosed(file, ref.bindingId) ? `${path}#${method}` : null;
    const fn = !ref.members.length && evidence.functions.find((item) => item.bindingId === ref.bindingId);
    return fn ? `${path}#${fn.id}` : null;
  }
  call(file: ProjectFile, call: SyntaxEvidence['calls'][number]) {
    if (call.kind !== 'call') return null;
    if (call.targetId) return `${file.snapshot.path}#${call.targetId}`;
    const ref = file.semantics?.links.calls.get(call.id) ?? (call.bindingId ? { bindingId: call.bindingId, members: [] } : null);
    return ref ? this.resolve(file, ref) : null;
  }
}

export function projectLinks(files: ProjectFile[]) {
  const resolver = new LinkResolver(files);
  return resolver.call.bind(resolver);
}
