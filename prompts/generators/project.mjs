import { profiles, resolveRule, entryBody } from './resolve.mjs';

/** 只为当前阶段的有效正文差异生成资源；来源元数据不影响正文去重。 */
export function projectStage(stage, selection, documents) {
    const candidates = profiles(selection),
        common = project(stage, candidates[0], selection, documents);
    const resources = new Map([['common', render(stage, common)]]),
        canonical = new Map();
    const resolved = new Map(),
        origins = { common: sources(common) };

    for (const profile of candidates) {
        const effective = project(stage, profile, selection, documents),
            delta = differences(common, effective);
        // evidence 等其他阶段的变更不能扩增 inject；标题和来源链也不构成专项。
        const signature = JSON.stringify(delta.map(({ id, entries }) => ({ id, entries })));
        let reference = 'common';
        if (delta.length) {
            reference = canonical.get(signature) ?? profile.id;
            if (!canonical.has(signature)) {
                canonical.set(signature, reference);
                resources.set(reference, render(stage, delta, true));
            }
            origins[profile.id] = sources(effective);
        }
        resolved.set(profile.id, { ...profile, reference });
    }
    return { resources, routes: routes(resolved), origins };
}

function project(stage, profile, selection, documents) {
    const keys = stage === 'inject' ? ['applicability', 'inject'] : ['applicability', 'check', 'evidence'];
    const selected = selection.rules
        .filter((rule) => rule.phases.includes(stage))
        .map((rule) => resolveRule(rule, documents, profile))
        .filter(Boolean);
    const available = new Set(selected.map(({ rule }) => rule.id));
    return selected.map(({ rule, entries, chain }) => {
        if (rule.requires.some((id) => !available.has(id)))
            throw new Error(`Dependency outside profile ${profile.id}: ${rule.id}`);
        return {
            id: rule.id,
            chain,
            entries: Object.fromEntries(keys.map((key) => [key, entryBody(entries, key).replace(/\r\n/g, '\n')])),
        };
    });
}

function differences(common, effective) {
    const baseline = new Map(common.map((rule) => [rule.id, rule.entries]));
    return effective
        .map((rule) => ({
            ...rule,
            entries: Object.fromEntries(
                Object.entries(rule.entries).filter(([key, body]) => baseline.get(rule.id)?.[key] !== body),
            ),
        }))
        .filter((rule) => Object.keys(rule.entries).length);
}

function routes(resolved) {
    return [...resolved.values()].filter((profile) => {
        if (profile.id === 'common') return false;
        if (!profile.language || !profile.framework) return profile.reference !== 'common';
        const framework = resolved.get(profile.framework)?.reference;
        const language = resolved.get(profile.language)?.reference;
        const fallback = framework !== 'common' ? framework : (language ?? 'common');
        // 显式恢复 common 的组合仍需一条路由，否则会误用语言专项。
        return profile.reference !== fallback;
    });
}

function render(stage, rules, override = false) {
    const header = override ? `# EER ${stage} overrides` : `# EER ${stage}: common`;
    const note = override
        ? 'Read common.md first. Replace only the named entries; inherit all omitted entries and conditions.'
        : 'Advisory source guidance; target rules and automatic prefilter are incomplete.';
    return (
        [
            header,
            note,
            ...rules.flatMap(({ id, entries }) => [
                `## ${id}`,
                ...Object.entries(entries).map(([name, body]) => `### ${name}\n${body}`),
            ]),
        ].join('\n\n') + '\n'
    );
}

const sources = (rules) => Object.fromEntries(rules.map(({ id, chain }) => [id, chain]));
