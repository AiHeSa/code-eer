import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

const root = process.cwd();
const base = join(root, 'services/code-review/ast');
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}
async function jar(path, name) {
  const directory = join(root, '.cache/jars');
  await mkdir(directory, { recursive: true });
  const target = join(directory, name);
  const url = `https://repo.maven.apache.org/maven2/${path}/${name}`;
  run('curl', ['-L', '--fail', '--retry', '2', '--max-time', '90', '-sS', url, '-o', target]);
  const checksum = spawnSync('curl', ['-L', '--fail', '--max-time', '30', '-sS', `${url}.sha256`], { encoding: 'utf8' });
  if (checksum.status !== 0) throw new Error(`Cannot fetch checksum for ${name}`);
  const actual = createHash('sha256').update(await readFile(target)).digest('hex');
  if (actual !== checksum.stdout.trim().split(/\s/)[0]) throw new Error(`Checksum mismatch: ${name}`);
  await writeFile(`${target}.sha256`, actual + '\n');
}
async function buildJava() {
  await jar('com/github/javaparser/javaparser-core/3.28.2', 'javaparser-core-3.28.2.jar');
  await jar('com/google/code/gson/gson/2.13.2', 'gson-2.13.2.jar');
  const source = join(base, 'java/src');
  const files = (await readdir(source)).filter((file) => file.endsWith('.java')).map((file) => join(source, file));
  await mkdir(join(base, 'java/build'), { recursive: true });
  run('javac', ['--release', '17', '-cp', join(root, '.cache/jars/*'), '-d', join(base, 'java/build'), ...files]);
}
const selected = process.argv.slice(2);
for (const language of selected.length ? selected : ['go', 'rust', 'java']) {
  if (language === 'go') {
    await mkdir(join(root, '.cache/bin'), { recursive: true });
    const localGo = join(root, '.cache/toolchains/go/bin/go');
    run(process.env.CODE_EER_GO ?? (existsSync(localGo) ? localGo : 'go'),
      ['build', '-o', join(root, '.cache/bin/go-ast'), '.'], join(base, 'go'));
  } else if (language === 'rust') run('cargo', ['build', '--release', '--locked'], join(base, 'rust'));
  else if (language === 'java') await buildJava();
  else throw new Error(`Unknown backend: ${language}`);
}
