import codex from '../adapters/codex/index.mjs';
import dsh from '../adapters/dsh/index.mjs';
import { digest } from './files.mjs';
import { loadCatalog } from './catalog.mjs';
import { loadDocuments } from './resolve.mjs';
import { projectStage } from './project.mjs';

export const adapters = { codex, dsh };
const stages = ['inject', 'check'];
const descriptions = {
    inject: 'Apply EER quality constraints before implementing or changing source code. Select guidance for the current language and framework; exclude documentation-only tasks.',
    check: 'Review source code using EER quality rules and evidence. Use for incremental or final code review and prototype graduation, including previously exempted code without a current diff; provide advisory findings rather than a blocking gate.',
};

export async function buildBundle(repository, { harness, targets } = {}) {
    if (!adapters[harness]) throw new Error(`Unsupported harness: ${harness}`);
    const selection = await loadCatalog(repository, targets);
    const documents = await loadDocuments(selection);
    const workflow = await selection.read('prompts/contracts/workflow.md');
    const files = new Map(),
        projections = {};
    for (const stage of stages) {
        const root = `${adapters[harness].skillRoot}/eer-${stage}`;
        const projected = projectStage(stage, selection, documents);
        files.set(`${root}/SKILL.md`, skill(stage, projected.routes));
        files.set(`${root}/references/workflow.md`, workflow);
        for (const [name, text] of projected.resources) files.set(`${root}/references/${name}.md`, text);
        projections[stage] = { default: 'common', routes: projected.routes, origins: projected.origins };
    }
    const manifest = await provenance(selection, harness, files);
    manifest.projections = projections;
    files.set('.code-eer/prompts/bundle.json', JSON.stringify(manifest, null, 2) + '\n');
    return { files, manifest, guidance: guidance(), adapter: adapters[harness] };
}

function skill(stage, routes) {
    const action =
        stage === 'inject'
            ? 'Before editing source code, apply the guidance with its conditions and exceptions. Reconsider applicability when scope changes.'
            : 'Review the current diff and evidence after a meaningful edit batch or before delivery. Default to postrun; runtime covers affected objects.';
    return (
        `---\nname: eer-${stage}\ndescription: ${descriptions[stage]}\n---\n# EER ${stage}\n\n${action}\n\n` +
        'Read [workflow](references/workflow.md) for prototype exemptions, graduation and authorization; then read [common guidance](references/common.md). Omitted targets use this default.\n\n' +
        (routes.length
            ? 'For each code object, select at most one override: exact language/framework pair, then framework, then language. Read common first; replace only named entries and inherit missing entries. Do not combine multiple framework overrides without explicit precedence.\n\n' +
              routes
                  .map(
                      (profile) =>
                          `- ${profile.language ?? 'any language'} / ${profile.framework ?? 'no specific framework'}: [${profile.reference}](references/${profile.reference}.md)`,
                  )
                  .join('\n') +
              '\n\n'
            : 'No target-specific overrides are currently defined for this stage.\n\n') +
        (stage === 'check'
            ? 'This bundle has no automatic delta prefilter. Missing baselines, unresolved calls, or unavailable evidence remain unknown/partial; do not report a full pass. A structural signal is a review candidate, not proof of a violation. Report confirmed issues and necessary limitations concisely. Review does not authorize unrelated edits.\n'
            : 'Retain necessary applicability conditions and exceptions. Token budget has not been measured; never truncate conditions to fit a budget.\n')
    );
}

async function provenance(selection, harness, files) {
    for (const name of ['context', 'resolution', 'results']) await selection.read(`prompts/contracts/${name}.md`);
    for (const stage of stages) await selection.read(`prompts/entries/${stage}.md`);
    const sources = Object.fromEntries([...selection.sources].sort(([a], [b]) => a.localeCompare(b)));
    return {
        format: 1,
        harness,
        mode: 'advisory',
        automaticReview: false,
        targets: selection.targets,
        sourceDigest: digest(JSON.stringify(sources)),
        sources,
        tokenBudget: { status: 'unverified', commonLimit: 200 },
        coverage: {
            status: 'partial',
            reasons: [selection.catalog.coverage, ...selection.coverage, 'Automatic prefilter not implemented'],
        },
        files: Object.fromEntries([...files].map(([name, text]) => [name, digest(text)])),
    };
}

function guidance() {
    return 'EER quality guidance (advisory): before source-code implementation, use the installed eer-inject skill and retain its applicability conditions. After a meaningful edit batch or before delivery, use eer-check for review; do not interrupt every edit or debugging step. Select guidance per code object. Missing evidence remains unknown/partial. These skills do not install a commit gate or automatic review hook.\n';
}
