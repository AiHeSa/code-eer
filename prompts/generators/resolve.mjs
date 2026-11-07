import { parseCapabilityDocument, validateDocumentInheritance } from '../../services/code-review/internal/capabilities/document.ts';

export async function loadDocuments(selection) {
  const documents = new Map();
  for (const rule of selection.rules) {
    if (!/^requirements\/[a-z0-9/-]+\.md$/.test(rule.source)) throw new Error(`Invalid rule root: ${rule.source}`);
    const common = parseCapabilityDocument(rule.source, await selection.read(`prompts/${rule.source}`));
    if (common.extends || ['applicability', 'inject', 'check', 'evidence'].some((key) => !common.entries.get(key)?.replace(/^## [^\n]+\n/, '').trim()))
      throw new Error(`Incomplete root contract: ${rule.id}`);
    const variants = new Map();
    for (const [target, path] of Object.entries(rule.variants)) {
      const expected = rule.source.replace(/\.md$/, `.${target}.md`);
      if (path !== expected) throw new Error(`Variant must share root name and directory: ${path}`);
      const document = parseCapabilityDocument(path, await selection.read(`prompts/${path}`));
      validateDocumentInheritance(common, document); variants.set(target, document);
    }
    documents.set(rule.id, { common, variants });
  }
  return documents;
}

export function profiles(selection) {
  const languages = selection.targets.filter((target) => selection.configuration.languages.includes(target));
  const frameworks = selection.targets.filter((target) => selection.configuration.frameworks.includes(target));
  return [null, ...languages].flatMap((language) => [null, ...frameworks].map((framework) => ({
    language, framework, id: [language, framework].filter(Boolean).join('-') || 'common',
  })));
}

export function resolveRule(rule, documents, profile) {
  if (rule.owners.length && !rule.owners.some((target) => matches(target, profile))) return null;
  const { common, variants } = documents.get(rule.id);
  const language = variants.get(profile.language) ?? (['js', 'ts'].includes(profile.language) ? variants.get('js-ts') : undefined);
  const framework = variants.get(profile.framework);
  const entries = new Map(common.entries), chain = [common.path];
  for (const special of [language, framework].filter(Boolean)) {
    for (const [name, body] of special.entries) entries.set(name, body);
    chain.push(special.path);
  }
  return { rule, entries, chain };
}

function matches(target, profile) {
  return target === profile.language || target === profile.framework
    || (target === 'js-ts' && ['js', 'ts'].includes(profile.language));
}

export function entryBody(entries, id) {
  return entries.get(id).replace(new RegExp(`^## ${id}\\s*\\n`), '').trim();
}
