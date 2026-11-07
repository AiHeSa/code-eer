import { lstat, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { digest, localPath, optionalText, rejectSymlinks } from './files.mjs';

const stateFile = '.code-eer/prompts/install.json';
const begin = '<!-- code-eer:quality:start -->';
const end = '<!-- code-eer:quality:end -->';
const owned = (name) => /^\.agents\/skills\/eer-(inject|check)\//.test(name) || name === '.code-eer/prompts/bundle.json';

export async function installBundle(project, bundle, { apply = false } = {}) {
  const root = await projectRoot(project), previous = await loadState(root);
  if (bundle.adapter.id === 'dsh') await rejectDshDuplicates(root);
  const files = bundle.files;
  await preflight(root, previous, files);
  const before = await optionalText(join(root, 'AGENTS.md'));
  const guidance = updateGuidance(before, previous, bundle.guidance);
  const state = { format: 1, files: hashes(files), agentsSegment: guidance.segment,
    agentsExisted: previous?.agentsExisted ?? before !== null };
  const plan = await changes(root, files, previous, before, guidance.content, JSON.stringify(state, null, 2) + '\n');
  if (apply) await applyChanges(root, plan);
  return report(plan, apply, bundle.manifest.coverage);
}

export async function uninstallBundle(project, { apply = false } = {}) {
  const root = await projectRoot(project), previous = await loadState(root);
  if (!previous) return report([], apply);
  await preflight(root, previous, new Map());
  const before = await optionalText(join(root, 'AGENTS.md'));
  verifySegment(before, previous.agentsSegment);
  const after = before.replace(previous.agentsSegment, '');
  const plan = Object.keys(previous.files).map((name) => ({ name, content: null }));
  plan.push({ name: 'AGENTS.md', content: !previous.agentsExisted && !after ? null : after });
  plan.push({ name: stateFile, content: null });
  if (apply) await applyChanges(root, plan);
  return report(plan, apply);
}

async function projectRoot(project) {
  const root = await realpath(project);
  for (let directory = root; ; directory = dirname(directory)) {
    try {
      await lstat(join(directory, '.git'));
      if (directory !== root) throw new Error('--project must be the Git root for shared harness discovery');
      return root;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (directory === dirname(directory)) return root;
  }
}

async function rejectDshDuplicates(root) {
  for (const name of ['eer-inject', 'eer-check']) for (const suffix of ['', '.md']) {
    const path = join(root, '.dsh/skills', name + suffix);
    try { await lstat(path); throw new Error(`Existing DSH-native skill conflicts with shared installation: ${name + suffix}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function loadState(root) {
  await rejectSymlinks(root, stateFile);
  const source = await optionalText(localPath(root, stateFile));
  if (source === null) return null;
  const state = JSON.parse(source);
  if (state.format !== 1 || !state.files || typeof state.files !== 'object' || Array.isArray(state.files)
    || typeof state.agentsSegment !== 'string' || !/^\n{0,2}<!-- code-eer:quality:start -->\n/.test(state.agentsSegment)
    || !state.agentsSegment.endsWith(`${end}\n`)
    || typeof state.agentsExisted !== 'boolean') throw new Error('Invalid installation state');
  for (const [name, hash] of Object.entries(state.files)) {
    localPath(root, name);
    if (!owned(name) || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid managed file in installation state');
  }
  return state;
}

async function preflight(root, previous, files) {
  const names = new Set([...Object.keys(previous?.files ?? {}), ...files.keys(), 'AGENTS.md', stateFile]);
  await rejectSymlinks(root, 'AGENTS.override.md');
  if (files.size && await optionalText(join(root, 'AGENTS.override.md')) !== null)
    throw new Error('AGENTS.override.md shadows the shared guidance; resolve the override before installing');
  for (const name of names) {
    await rejectSymlinks(root, name);
    if (name === 'AGENTS.md' || name === stateFile) continue;
    if (!owned(name)) throw new Error(`Unexpected managed output: ${name}`);
    const content = await optionalText(localPath(root, name)), expected = previous?.files[name];
    if (expected && (content === null || digest(content) !== expected)) throw new Error(`Managed file changed: ${name}`);
    if (!expected && content !== null) throw new Error(`Refusing to overwrite unowned file: ${name}`);
  }
}

function verifySegment(content, segment) {
  if (content === null || content.split(segment).length !== 2) throw new Error('Managed AGENTS.md block changed or missing');
  if (content.split(begin).length !== 2 || content.split(end).length !== 2) throw new Error('Ambiguous AGENTS.md markers');
}

function updateGuidance(before, previous, text) {
  const block = `${begin}\n${text}${end}\n`;
  if (previous) {
    verifySegment(before, previous.agentsSegment);
    const prefix = previous.agentsSegment.slice(0, previous.agentsSegment.indexOf(begin));
    const segment = prefix + block;
    return { content: before.replace(previous.agentsSegment, segment), segment };
  }
  if (before?.includes(begin) || before?.includes(end)) throw new Error('Unowned AGENTS.md markers');
  const prefix = !before ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const segment = prefix + block;
  return { content: (before ?? '') + segment, segment };
}

const hashes = (files) => Object.fromEntries([...files].map(([name, content]) => [name, digest(content)]));

async function changes(root, files, previous, agentsBefore, agentsAfter, state) {
  const plan = [];
  for (const name of Object.keys(previous?.files ?? {})) if (!files.has(name)) plan.push({ name, content: null });
  for (const [name, content] of files) {
    if (await optionalText(localPath(root, name)) !== content) plan.push({ name, content });
  }
  if (agentsBefore !== agentsAfter) plan.push({ name: 'AGENTS.md', content: agentsAfter });
  if (await optionalText(localPath(root, stateFile)) !== state) plan.push({ name: stateFile, content: state });
  return plan;
}

async function applyChanges(root, plan) {
  const backup = new Map(), completed = [];
  for (const { name } of plan) {
    await rejectSymlinks(root, name); backup.set(name, await optionalText(localPath(root, name)));
  }
  try {
    for (const { name, content } of plan) { await mutate(root, name, content); completed.push(name); }
  } catch (error) {
    const rollbackErrors = [];
    for (const name of completed.reverse()) {
      try { await mutate(root, name, backup.get(name)); } catch (failure) { rollbackErrors.push(failure); }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'Installation failed; rollback incomplete');
    throw error;
  }
}

async function mutate(root, name, content) {
  await rejectSymlinks(root, name);
  const path = localPath(root, name);
  if (content === null) { await rm(path, { force: true }); return; }
  await mkdir(dirname(path), { recursive: true });
  const mode = await lstat(path).then((stat) => stat.mode & 0o777, (error) => {
    if (error.code === 'ENOENT') return 0o666; throw error;
  });
  const temporary = `${path}.eer-${randomUUID()}`;
  try { await writeFile(temporary, content, { flag: 'wx', mode }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

function report(plan, applied, coverage) {
  return { applied, mode: 'advisory', changes: plan.map(({ name, content }) => ({ path: name, action: content === null ? 'remove' : 'write' })),
    ...(coverage ? { coverage } : {}) };
}
