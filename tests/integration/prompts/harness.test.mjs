import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { buildBundle } from '../../../prompts/generators/build.mjs';
import { buildHarnessBundle } from '../../../prompts/generators/harness.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

async function directory(t) {
    const root = await mkdtemp(join(tmpdir(), "eer harness ' "));
    t.after(() => rm(root, { recursive: true, force: true }));
    return root;
}

async function writeBundle(root, bundle) {
    for (const [name, content] of bundle.files) {
        const path = join(root, name);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content);
    }
    return join(root, 'plugins/eer-quality');
}

function hook(root, event = 'SessionStart') {
    return spawnSync(process.execPath, [join(root, 'hook.mjs')], {
        cwd: tmpdir(),
        encoding: 'utf8',
        input: JSON.stringify({ hook_event_name: event, prompt: 'Untrusted prompt is not rendered', cwd: '/other' }),
    });
}

test('ordinary Skill builds remain advisory; native exports require separate explicit host activation', async () => {
    const ordinary = await buildBundle(repository, { harness: 'codex' });
    assert.equal(ordinary.manifest.mode, 'advisory');
    assert.ok(![...ordinary.files.keys()].some((name) => /hooks|marketplace|cordis/.test(name)));
    const codex = await buildHarnessBundle(repository, { harness: 'codex' });
    assert.equal(codex.manifest.enabledByDefault, false);
    assert.equal(codex.manifest.automaticReview, false);
    const market = JSON.parse(codex.files.get('.agents/plugins/marketplace.json'));
    assert.equal(market.plugins[0].policy.installation, 'AVAILABLE');
    const dsh = await buildHarnessBundle(repository, { harness: 'dsh' });
    assert.match(dsh.files.get('plugins/eer-quality/cordis.patch.yml'), /disabled: true/);
    assert.equal(JSON.parse(dsh.files.get('plugins/eer-quality/package.json')).dsh.bundle.listedByDefault, false);
    assert.deepEqual(codex.files, (await buildHarnessBundle(repository, { harness: 'codex' })).files);
});

test('Codex hooks emit actual rules and applicability from a relocatable bundle, with no cwd dependency', async (t) => {
    const bundle = await buildHarnessBundle(repository, { harness: 'codex', targets: ['ts', 'react'] });
    const root = await writeBundle(await directory(t), bundle);
    for (const event of ['SessionStart', 'UserPromptSubmit', 'SubagentStart']) {
        const result = hook(root, event);
        assert.equal(result.status, 0, result.stderr);
        const { hookSpecificOutput } = JSON.parse(result.stdout);
        assert.equal(hookSpecificOutput.hookEventName, event);
        const text = hookSpecificOutput.additionalContext;
        assert.match(text, /code-eer:harness-injection source=/);
        assert.match(text, /对齐同类先例，在满足职责、依赖和规模约束/);
        assert.match(text, /契约允许缺值、外部回调或恢复流程/);
        assert.match(text, /# EER check/);
        assert.ok(text.includes(join(root, 'guidance/eer-check/references/common.md')));
        assert.doesNotMatch(text, /Untrusted prompt|### evidence|### check/);
    }
    assert.deepEqual(await readdir(join(root, 'guidance/eer-inject/references')), ['common.md']);
    const configuration = JSON.parse(await readFile(join(root, 'hooks/hooks.json'), 'utf8'));
    assert.deepEqual(Object.keys(configuration.hooks), ['SessionStart', 'SubagentStart', 'UserPromptSubmit']);
    for (const groups of Object.values(configuration.hooks)) {
        assert.equal(groups[0].hooks[0].async, undefined);
        assert.equal(groups[0].hooks[0].additionalContextLimit, 50000);
    }
    const configured = spawnSync('/bin/sh', ['-c', configuration.hooks.SessionStart[0].hooks[0].command], {
        cwd: tmpdir(),
        encoding: 'utf8',
        env: { ...process.env, PLUGIN_ROOT: root, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}` },
        input: JSON.stringify({ hook_event_name: 'SessionStart' }),
    });
    assert.equal(configured.status, 0, configured.stderr);
    assert.match(JSON.parse(configured.stdout).hookSpecificOutput.additionalContext, /code-eer:harness-injection/);
});

test('adapter reports invalid events, changed resources and oversized contracts instead of claiming injection', async (t) => {
    const bundle = await buildHarnessBundle(repository, { harness: 'codex' });
    const root = await writeBundle(await directory(t), bundle);
    assert.notEqual(hook(root, 'Stop').status, 0);
    const path = join(root, 'guidance/eer-inject/references/common.md');
    await writeFile(path, 'tampered guidance');
    const result = hook(root);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /guidance changed/);

    const contract = await import(pathToFileURL(join(root, 'contract.mjs')));
    const { createHash } = await import('node:crypto');
    const text = 'x'.repeat(24001);
    await writeFile(path, text);
    const policyPath = join(root, 'quality.json');
    const policy = JSON.parse(await readFile(policyPath, 'utf8'));
    policy.files['guidance/eer-inject/references/common.md'] = createHash('sha256').update(text).digest('hex');
    await writeFile(policyPath, JSON.stringify(policy));
    assert.throws(() => contract.loadContract(pathToFileURL(root + '/')), /contract budget/);
});

test('DSH activation registers one required literal context and returns its exact cleanup', async (t) => {
    const root = await writeBundle(await directory(t), await buildHarnessBundle(repository, { harness: 'dsh' }));
    const plugin = await import(pathToFileURL(join(root, 'index.mjs')));
    const registrations = [];
    const dispose = () => registrations.pop();
    const result = plugin.apply({
        systemPrompt: {
            context: (entry) => {
                registrations.push(entry);
                return dispose;
            },
        },
    });
    assert.equal(result, dispose);
    assert.deepEqual(plugin.inject, ['systemPrompt']);
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].required, true);
    assert.equal(registrations[0].interpolate, false);
    assert.match(registrations[0].text, /对齐同类先例，在满足职责、依赖和规模约束/);
    result();
    assert.equal(registrations.length, 0);
});

test('native package keeps only effective language deltas, loaded progressively through rebased entry links', async (t) => {
    const source = await directory(t);
    await cp(join(repository, 'prompts'), join(source, 'prompts'), { recursive: true });
    await mkdir(join(source, 'config'));
    await cp(join(repository, 'config/capability-targets.json'), join(source, 'config/capability-targets.json'));
    const catalogPath = join(source, 'prompts/routing/catalog.json');
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
    catalog.commonRules[0].variants.ts = 'requirements/scope/minimal-link.ts.md';
    await writeFile(catalogPath, JSON.stringify(catalog));
    await writeFile(
        join(source, 'prompts/requirements/scope/minimal-link.ts.md'),
        '---\nextends: ./minimal-link.md\n---\n## inject\nUnique TS guidance\n',
    );
    const bundle = await buildHarnessBundle(source, { harness: 'codex', targets: ['ts', 'python'] });
    const root = await writeBundle(await directory(t), bundle);
    const result = hook(root);
    assert.equal(result.status, 0, result.stderr);
    const text = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    assert.ok(text.includes(join(root, 'guidance/eer-inject/references/ts.md')));
    assert.doesNotMatch(text, /Unique TS guidance/);
    assert.match(await readFile(join(root, 'guidance/eer-inject/references/ts.md'), 'utf8'), /Unique TS guidance/);
    assert.deepEqual(await readdir(join(root, 'guidance/eer-check/references')), ['common.md']);
    assert.deepEqual(await readdir(join(root, 'guidance/eer-inject/references')), ['common.md', 'ts.md']);
});

test('build-harness CLI previews without writing and exports only into an explicitly named new directory', async (t) => {
    const root = await directory(t);
    const run = (...args) =>
        spawnSync(process.execPath, [join(repository, 'scripts/prompts.mjs'), ...args], {
            cwd: root,
            encoding: 'utf8',
        });
    const preview = run('build-harness', '--harness', 'dsh');
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(JSON.parse(preview.stdout).enabledByDefault, false);
    assert.deepEqual(await readdir(root), []);
    const output = join(root, 'bundle');
    const built = run('build-harness', '--harness', 'dsh', '--output', output);
    assert.equal(built.status, 0, built.stderr);
    assert.match(await readFile(join(output, 'plugins/eer-quality/cordis.patch.yml'), 'utf8'), /disabled: true/);
    assert.notEqual(run('build-harness', '--harness', 'dsh', '--output', output).status, 0);
    assert.notEqual(run('build-harness', '--harness', 'dsh', '--apply').status, 0);
    assert.notEqual(run('build-harness', '--harness', 'dsh', '--project', root).status, 0);
});
