import assert from 'node:assert/strict';
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildBundle } from '../../../prompts/generators/build.mjs';
import { installBundle, uninstallBundle } from '../../../prompts/generators/install.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const bundle = await buildBundle(repository, { harness: 'codex', targets: ['ts', 'react'] });

async function workspace(t) {
    const root = await mkdtemp(join(tmpdir(), 'eer-install-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    return root;
}

test('preview is read-only; install is idempotent and uninstall preserves existing AGENTS bytes', async (t) => {
    const root = await workspace(t),
        path = join(root, 'AGENTS.md');
    const original = '# Existing\r\nKeep local instructions without trailing newline';
    await writeFile(path, original);
    await chmod(path, 0o600);
    assert.equal((await installBundle(root, bundle)).applied, false);
    assert.deepEqual(await readdir(root), ['AGENTS.md']);
    await installBundle(root, bundle, { apply: true });
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await installBundle(root, bundle)).changes.length, 0);
    assert.equal((await installBundle(root, bundle, { apply: true })).changes.length, 0);
    await uninstallBundle(root, { apply: true });
    assert.equal(await readFile(path, 'utf8'), original);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    for (const name of bundle.files.keys()) await assert.rejects(access(join(root, name)), { code: 'ENOENT' });
});

test('uninstall retains instructions added outside the managed block and removes a newly created empty AGENTS file', async (t) => {
    const root = await workspace(t);
    await installBundle(root, bundle, { apply: true });
    const path = join(root, 'AGENTS.md');
    await writeFile(path, (await readFile(path, 'utf8')) + '\nUser addition\n');
    await uninstallBundle(root, { apply: true });
    assert.equal(await readFile(path, 'utf8'), '\nUser addition\n');
    const empty = await workspace(t);
    await installBundle(empty, bundle, { apply: true });
    await uninstallBundle(empty, { apply: true });
    await assert.rejects(access(join(empty, 'AGENTS.md')), { code: 'ENOENT' });
});

test('updates remove stale managed profiles, retain extra user files and support switching harnesses', async (t) => {
    const root = await workspace(t);
    const legacyFiles = new Map(bundle.files);
    legacyFiles.set(
        '.agents/skills/eer-inject/references/ts-react.md',
        bundle.files.get('.agents/skills/eer-inject/references/common.md'),
    );
    await installBundle(root, { ...bundle, files: legacyFiles }, { apply: true });
    const extra = join(root, '.agents/skills/eer-inject/user-notes.txt');
    await writeFile(extra, 'User notes');
    const smaller = await buildBundle(repository, { harness: 'dsh', targets: [] });
    await installBundle(root, smaller, { apply: true });
    await assert.rejects(access(join(root, '.agents/skills/eer-inject/references/ts-react.md')), { code: 'ENOENT' });
    assert.equal(await readFile(extra, 'utf8'), 'User notes');
    await uninstallBundle(root, { apply: true });
    assert.equal(await readFile(extra, 'utf8'), 'User notes');
});

test('changed managed files or guidance stop updates and uninstall before any writes', async (t) => {
    const root = await workspace(t);
    await installBundle(root, bundle, { apply: true });
    const path = join(root, '.agents/skills/eer-check/SKILL.md');
    const before = await readFile(join(root, 'AGENTS.md'), 'utf8');
    await writeFile(path, 'User modification');
    await assert.rejects(installBundle(root, bundle, { apply: true }), /Managed file changed/);
    await assert.rejects(uninstallBundle(root, { apply: true }), /Managed file changed/);
    assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), before);
    const other = await workspace(t);
    await installBundle(other, bundle, { apply: true });
    await writeFile(join(other, 'AGENTS.md'), 'Replaced guidance');
    await assert.rejects(uninstallBundle(other, { apply: true }), /block changed/);
    assert.equal(
        await readFile(join(other, '.agents/skills/eer-check/SKILL.md'), 'utf8'),
        bundle.files.get('.agents/skills/eer-check/SKILL.md'),
    );
});

test('unowned files, symlinked destinations and shadowing overrides are rejected', async (t) => {
    const root = await workspace(t),
        folder = join(root, '.agents/skills/eer-inject');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'SKILL.md'), 'Existing skill');
    await assert.rejects(installBundle(root, bundle, { apply: true }), /unowned/);
    await assert.rejects(access(join(root, 'AGENTS.md')), { code: 'ENOENT' });
    const links = await workspace(t),
        outside = await workspace(t);
    await symlink(outside, join(links, '.agents'));
    await assert.rejects(installBundle(links, bundle, { apply: true }), /symlink/);
    assert.deepEqual(await readdir(outside), []);
    const overridden = await workspace(t);
    await writeFile(join(overridden, 'AGENTS.override.md'), '# Override');
    await assert.rejects(installBundle(overridden, bundle, { apply: true }), /shadows/);
});

test('malformed install state cannot delete files outside managed locations', async (t) => {
    const root = await workspace(t),
        state = join(root, '.code-eer/prompts');
    await mkdir(state, { recursive: true });
    await writeFile(join(root, 'user.txt'), 'Preserve');
    await writeFile(
        join(state, 'install.json'),
        JSON.stringify({
            format: 1,
            files: { 'user.txt': 'a'.repeat(64) },
            agentsSegment: '<!-- code-eer:quality:start -->\nText\n<!-- code-eer:quality:end -->\n',
            agentsExisted: false,
        }),
    );
    await assert.rejects(uninstallBundle(root, { apply: true }), /Invalid managed file/);
    assert.equal(await readFile(join(root, 'user.txt'), 'utf8'), 'Preserve');
});

test('DSH native skill conflicts and Git-subdirectory installs fail before modifying the workspace', async (t) => {
    const root = await workspace(t);
    await mkdir(join(root, '.dsh/skills/eer-inject'), { recursive: true });
    const dsh = await buildBundle(repository, { harness: 'dsh', targets: [] });
    await assert.rejects(installBundle(root, dsh, { apply: true }), /DSH-native skill conflicts/);
    await assert.rejects(access(join(root, 'AGENTS.md')), { code: 'ENOENT' });
    const git = await workspace(t);
    await mkdir(join(git, '.git'));
    await mkdir(join(git, 'child'));
    await assert.rejects(installBundle(join(git, 'child'), bundle, { apply: true }), /Git root/);
    assert.deepEqual(await readdir(join(git, 'child')), []);
});
