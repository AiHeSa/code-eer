import { z } from 'zod';
import { sourceText, digest } from './files.mjs';

const id = z.string().regex(/^[a-z][a-z0-9-]*$/);
const ruleSchema = z.strictObject({
  id, category: id, summary: z.string().min(1), source: z.string().min(1),
  phases: z.array(z.enum(['inject', 'check'])).min(1), requires: z.array(id),
  checkTrigger: z.strictObject({ any: z.array(z.string().min(1)).min(1) }),
  variants: z.record(id, z.string().min(1)),
});
const catalogSchema = z.strictObject({
  version: z.literal('prompt-catalog-v1'), status: z.string(), coverage: z.string(),
  targetRouters: z.record(id, z.string().min(1)), commonRules: z.array(ruleSchema),
});
const routerSchema = z.strictObject({
  target: id, kind: z.enum(['language', 'framework']), status: z.string(), rules: z.array(ruleSchema),
});

export async function loadCatalog(repository, requested) {
  const sources = new Map();
  const read = async (name) => {
    const content = await sourceText(repository, name);
    sources.set(name, digest(content)); return content;
  };
  const configuration = JSON.parse(await read('config/capability-targets.json'));
  const catalog = catalogSchema.parse(JSON.parse(await read('prompts/routing/catalog.json')));
  const known = [...configuration.languages, ...configuration.frameworks];
  const targets = [...new Set(requested ?? known)].sort();
  if (targets.some((target) => !known.includes(target))) throw new Error('Unregistered requested target');
  if (Object.keys(catalog.targetRouters).some((target) => !known.includes(target))) throw new Error('Unregistered router target');
  const { rules, coverage } = await targetRules(catalog, targets, configuration, read);
  const triggers = await read('prompts/contracts/triggers.md');
  const signals = new Set([...triggers.matchAll(/\| (delta:[a-z-]+) \|/g)].map((match) => match[1]));
  validateRules(rules, signals, known);
  return { catalog, configuration, targets, rules: schedule(rules), coverage, sources, read };
}

async function targetRules(catalog, targets, configuration, read) {
  const rules = catalog.commonRules.map((rule) => ({ ...rule, owners: [] })), coverage = [], seen = new Set();
  for (const target of targets) {
    const path = catalog.targetRouters[target];
    if (!path) throw new Error(`Missing target router: ${target}`);
    if (seen.has(path)) continue;
    seen.add(path);
    const router = routerSchema.parse(JSON.parse(await read(`prompts/${path}`)));
    const aliases = ['js', 'ts', 'js-ts'];
    if (router.target !== target && !(aliases.includes(target) && router.target === 'js-ts'))
      throw new Error(`Router target mismatch: ${target}`);
    const expected = configuration.languages.includes(target) ? 'language' : 'framework';
    if (router.kind !== expected) throw new Error(`Router kind mismatch: ${target}`);
    if (!router.rules.length || router.status === 'pending-rules') coverage.push(`Target rules pending: ${router.target}`);
    rules.push(...router.rules.map((rule) => ({ ...rule, owners: [router.target] })));
  }
  return { rules, coverage };
}

function validateRules(rules, signals, targets) {
  const ids = new Set(rules.map((rule) => rule.id));
  if (ids.size !== rules.length) throw new Error('Duplicate rule ID');
  for (const rule of rules) {
    if (rule.requires.some((id) => !ids.has(id))) throw new Error(`Missing dependency: ${rule.id}`);
    if (rule.checkTrigger.any.some((id) => !signals.has(id))) throw new Error(`Unknown trigger: ${rule.id}`);
    if (Object.keys(rule.variants).some((target) => !targets.includes(target))) throw new Error(`Unknown variant: ${rule.id}`);
    for (const required of rule.requires) {
      const dependency = rules.find((item) => item.id === required);
      if (rule.phases.some((phase) => !dependency.phases.includes(phase))) throw new Error(`Dependency phase mismatch: ${rule.id}`);
    }
  }
}

function schedule(rules) {
  const remaining = [...rules], ordered = [], done = new Set();
  while (remaining.length) {
    const index = remaining.findIndex((rule) => rule.requires.every((id) => done.has(id)));
    if (index < 0) throw new Error('Cyclic rule dependency');
    const [rule] = remaining.splice(index, 1); ordered.push(rule); done.add(rule.id);
  }
  return ordered;
}
