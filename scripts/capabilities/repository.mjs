import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
  return result.stdout;
}

export async function repositoryFiles(root, staged) {
  if (!staged) {
    const paths = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    return new Map(await Promise.all([...new Set(paths.split('\0').filter(Boolean))].map(async (path) => {
      try { return [path, await readFile(join(root, path), 'utf8')]; }
      catch (error) { if (error.code === 'ENOENT') return [path, null]; throw error; }
    })));
  }
  const entries = git(root, ['ls-files', '--stage', '-z']).split('\0').filter(Boolean).map((entry) => {
    const separator = entry.indexOf('\t');
    const [mode, oid, stage] = entry.slice(0, separator).split(' ');
    if (stage !== '0') throw new Error('Resolve index conflicts before checking inheritance');
    return { path: entry.slice(separator + 1), mode, oid };
  });
  return new Map(entries.map(({ path, mode, oid }) => [path,
    mode === '120000' || mode === '160000' ? null : git(root, ['cat-file', 'blob', oid])]));
}

export async function writeSnapshot(directory, files) {
  for (const [path, source] of files) {
    if (source === null) continue;
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), source);
  }
}
