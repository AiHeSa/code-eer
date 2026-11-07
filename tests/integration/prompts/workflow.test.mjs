import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { buildBundle } from '../../../prompts/generators/build.mjs';
import { buildHarnessBundle } from '../../../prompts/generators/harness.mjs';
import { installBundle, uninstallBundle } from '../../../prompts/generators/install.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sourcePath = 'prompts/contracts/workflow.md';

async function directory(t) {
    const root = await mkdtemp(join(tmpdir(), 'eer-workflow-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    return root;
}

test('both standalone stages and both native adapters carry the complete shared workflow', async (t) => {
    const workflow = await readFile(join(repository, sourcePath), 'utf8');
    for (const harness of ['codex', 'dsh']) {
        const ordinary = await buildBundle(repository, { harness, targets: [] });
        assert.ok(ordinary.manifest.sources[sourcePath]);
        for (const stage of ['inject', 'check']) {
            const prefix = `.agents/skills/eer-${stage}/`;
            assert.match(ordinary.files.get(`${prefix}SKILL.md`), /\]\(references\/workflow\.md\)/);
            assert.equal(ordinary.files.get(`${prefix}references/workflow.md`), workflow);
        }
        const native = await buildHarnessBundle(repository, { harness, targets: [] });
        const root = await directory(t);
        for (const [name, text] of native.files) {
            await mkdir(dirname(join(root, name)), { recursive: true });
            await writeFile(join(root, name), text);
        }
        const packageRoot = join(root, 'plugins/eer-quality/');
        const contract = await import(pathToFileURL(join(packageRoot, 'contract.mjs')));
        assert.ok(contract.loadContract(pathToFileURL(packageRoot)).includes(workflow));
        await writeFile(join(packageRoot, 'guidance/eer-inject/references/workflow.md'), 'changed workflow');
        assert.throws(() => contract.loadContract(pathToFileURL(packageRoot)), /guidance changed/);
    }
});

test('workflow edits invalidate bundle provenance and missing workflow fails generation', async (t) => {
    const root = await directory(t);
    await cp(join(repository, 'prompts'), join(root, 'prompts'), { recursive: true });
    await mkdir(join(root, 'config'));
    await cp(join(repository, 'config/capability-targets.json'), join(root, 'config/capability-targets.json'));
    const before = await buildBundle(root, { harness: 'codex', targets: [] });
    const path = join(root, sourcePath);
    await writeFile(path, (await readFile(path, 'utf8')) + '\nWorkflow revision\n');
    const after = await buildBundle(root, { harness: 'codex', targets: [] });
    assert.notEqual(after.manifest.sourceDigest, before.manifest.sourceDigest);
    for (const stage of ['inject', 'check']) {
        const name = `.agents/skills/eer-${stage}/references/workflow.md`;
        assert.notEqual(after.manifest.files[name], before.manifest.files[name]);
    }
    await rm(path);
    await assert.rejects(buildBundle(root, { harness: 'codex', targets: [] }), { code: 'ENOENT' });
});

test('installation, updates and uninstall preserve project-owned exemption history byte for byte', async (t) => {
    const root = await directory(t);
    const path = join(root, '.code-eer/prompts/exemptions.json');
    await mkdir(dirname(path), { recursive: true });
    const ledger = '{"format":1,"exemptions":[{"id":"prototype-1","status":"pending-review"}]}\n';
    await writeFile(path, ledger);
    const bundle = await buildBundle(repository, { harness: 'codex', targets: [] });
    await installBundle(root, bundle, { apply: true });
    assert.equal(await readFile(path, 'utf8'), ledger);
    const update = await buildBundle(repository, { harness: 'dsh', targets: ['ts'] });
    await installBundle(root, update, { apply: true });
    assert.equal(await readFile(path, 'utf8'), ledger);
    await uninstallBundle(root, { apply: true });
    assert.equal(await readFile(path, 'utf8'), ledger);
});
