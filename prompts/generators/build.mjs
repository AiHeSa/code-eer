import codex from '../adapters/codex/index.mjs';
import dsh from '../adapters/dsh/index.mjs';
import { digest } from './files.mjs';
import { loadCatalog } from './catalog.mjs';
import { loadDocuments, profiles, resolveRule, entryBody } from './resolve.mjs';

export const adapters = { codex, dsh };
const stages = ['inject', 'check'];
const descriptions = {
  inject: 'Apply EER quality constraints before implementing or changing source code. Select guidance for the current language and framework; exclude documentation-only tasks.',
  check: 'Review completed source-code changes using EER quality rules and evidence. Use for incremental or final code review; provide advisory findings rather than a blocking gate.',
};

export async function buildBundle(repository, { harness, targets } = {}) {
  if (!adapters[harness]) throw new Error(`Unsupported harness: ${harness}`);
  const selection = await loadCatalog(repository, targets);
  const documents = await loadDocuments(selection), variants = profiles(selection);
  const files = new Map();
  for (const stage of stages) {
    const root = `${adapters[harness].skillRoot}/eer-${stage}`;
    files.set(`${root}/SKILL.md`, skill(stage, variants));
    for (const profile of variants) files.set(`${root}/references/${profile.id}.md`, renderProfile(stage, profile, selection, documents));
  }
  const manifest = await provenance(selection, harness, files);
  files.set('.code-eer/prompts/bundle.json', JSON.stringify(manifest, null, 2) + '\n');
  return { files, manifest, guidance: guidance(), adapter: adapters[harness] };
}

function skill(stage, variants) {
  const action = stage === 'inject'
    ? 'Before editing source code, select the profile below and apply its conditions and constraints together. If scope changes, select again.'
    : 'Review the current diff and evidence after a meaningful edit batch or before delivery. Default to postrun; runtime covers affected objects.';
  return `---\nname: eer-${stage}\ndescription: ${descriptions[stage]}\n---\n# EER ${stage}\n\n${action}\n\n`
    + 'Select exactly one profile for each code object using its language and framework. Use a language-only profile without a known framework; use common for unknown targets. Do not apply one target to the whole repository.\n\n'
    + variants.map((profile) => `- ${profile.language ?? 'unknown language'} / ${profile.framework ?? 'no known framework'}: [guidance](references/${profile.id}.md)`).join('\n')
    + '\n\nRead only the matching profile. Multiple frameworks on one object require explicit precedence; do not silently combine profiles. Missing targets and pending target rules limit coverage.\n\n'
    + (stage === 'check' ? 'This bundle has no automatic delta prefilter. Missing baselines, unresolved calls, or unavailable evidence remain unknown/partial; do not report a full pass. A structural signal is a review candidate, not proof of a violation. Report confirmed issues and necessary limitations concisely. Review does not authorize unrelated edits.\n' : 'Retain necessary applicability conditions and exceptions. Token budget has not been measured; never truncate conditions to fit a budget.\n');
}

function renderProfile(stage, profile, selection, documents) {
  const keys = stage === 'inject' ? ['applicability', 'inject'] : ['applicability', 'check', 'evidence'];
  const content = [`# EER ${stage}: ${profile.id}`, 'Advisory source guidance; target rules and automatic prefilter are incomplete.'];
  const selected = selection.rules.filter((rule) => rule.phases.includes(stage))
    .map((rule) => resolveRule(rule, documents, profile)).filter(Boolean);
  const available = new Set(selected.map(({ rule }) => rule.id));
  for (const resolved of selected) {
    const { rule } = resolved;
    if (rule.requires.some((id) => !available.has(id))) throw new Error(`Dependency outside profile ${profile.id}: ${rule.id}`);
    content.push(`## ${rule.id}`, ...keys.map((key) => `### ${key}\n${entryBody(resolved.entries, key)}`));
    content.push(`Source chain: ${resolved.chain.join(' → ')}`);
  }
  return content.join('\n\n') + '\n';
}

async function provenance(selection, harness, files) {
  for (const name of ['context', 'resolution', 'results']) await selection.read(`prompts/contracts/${name}.md`);
  for (const stage of stages) await selection.read(`prompts/entries/${stage}.md`);
  const sources = Object.fromEntries([...selection.sources].sort(([a], [b]) => a.localeCompare(b)));
  return { format: 1, harness, mode: 'advisory', automaticReview: false, targets: selection.targets,
    sourceDigest: digest(JSON.stringify(sources)), sources,
    tokenBudget: { status: 'unverified', commonLimit: 200 },
    coverage: { status: 'partial', reasons: [selection.catalog.coverage, ...selection.coverage, 'Automatic prefilter not implemented'] },
    files: Object.fromEntries([...files].map(([name, text]) => [name, digest(text)])) };
}

function guidance() {
  return 'EER quality guidance (advisory): before source-code implementation, use the installed eer-inject skill and retain its applicability conditions. After a meaningful edit batch or before delivery, use eer-check for review; do not interrupt every edit or debugging step. Select guidance per code object. Missing evidence remains unknown/partial. These skills do not install a commit gate or automatic review hook.\n';
}
