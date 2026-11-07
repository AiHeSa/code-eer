import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
function command(executable, args) {
  const result = spawnSync(executable, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${executable}: ${result.stderr || result.error}`);
  return result.stdout.trim();
}
async function synSource() {
  const local = resolve('.cache/toolchains/cargo');
  const registry = join(process.env.CARGO_HOME ?? (existsSync(local) ? local : join(homedir(), '.cargo')), 'registry/src');
  for (const directory of await readdir(registry)) {
    const path = join(registry, directory, 'syn-2.0.119/src/item.rs');
    try { await readFile(path); return path; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error('syn 2.0.119 source is missing; run npm run setup:backends -- rust');
}
async function javaSource() {
  const url = 'https://raw.githubusercontent.com/javaparser/javaparser/javaparser-parent-3.28.2/javaparser-core/src/main/java/com/github/javaparser/ast/Node.java';
  const path = resolve('.cache/javaparser-Node.java');
  await mkdir(dirname(path), { recursive: true });
  try { await readFile(path); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    command('curl', ['-fLsS', '--max-time', '30', url, '-o', path]);
  }
  const digest = createHash('sha256').update(await readFile(path)).digest('hex');
  if (digest !== 'cd5cb33c58c1e86aa061ccb4c67e2b87f98fb95f00c2ce24435e7e8f20735036') throw new Error('Java corpus checksum mismatch');
  return { path, url };
}
export async function corpusSources() {
  const localPython = resolve('.cache/toolchains/python/bin/python3'), localGo = resolve('.cache/toolchains/go/bin/go');
  const python = command(process.env.CODE_EER_PYTHON ?? (existsSync(localPython) ? localPython : 'python3'),
    ['-c', 'import sysconfig; print(sysconfig.get_path("stdlib"))']);
  const go = command(process.env.CODE_EER_GO ?? (existsSync(localGo) ? localGo : 'go'), ['env', 'GOROOT']);
  const java = await javaSource();
  const ts = dirname(require.resolve('typescript/ast'));
  return [
    { backend: 'js-ts', name: 'ast.generated.d.ts', path: join(ts, 'ast.generated.d.ts'), source: 'TypeScript 7.1.0-beta AST declarations' },
    { backend: 'js-ts', name: 'compiler-sfc.d.ts', path: join(dirname(require.resolve('@vue/compiler-sfc')), 'compiler-sfc.d.ts'), source: 'Vue compiler-sfc 3.5.45 declarations' },
    { backend: 'python', name: 'ast.py', path: join(python, 'ast.py'), source: 'Installed CPython standard library' },
    { backend: 'go', name: 'parser.go', path: join(go, 'src/go/parser/parser.go'), source: 'Installed Go standard library' },
    { backend: 'rust', name: 'item.rs', path: await synSource(), source: 'syn 2.0.119 item parser' },
    { backend: 'java', name: 'Node.java', path: java.path, source: java.url },
  ];
}
