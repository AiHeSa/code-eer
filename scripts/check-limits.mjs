import { readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { API } from 'typescript/async';
import { isFunctionLikeDeclaration } from 'typescript/ast';
import { extname, resolve, delimiter } from 'node:path';
import { existsSync } from 'node:fs';

const git = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' });
if (git.status !== 0) throw new Error(git.stderr);
const files = [...new Set(git.stdout.split('\0').filter(Boolean))];
const violations = [];
const root = process.cwd();
const native = {
  '.py': [process.env.CODE_EER_PYTHON ?? (existsSync('.cache/toolchains/python/bin/python3')
    ? '.cache/toolchains/python/bin/python3' : 'python3'), ['services/code-review/ast/python/parser.py']],
  '.go': ['.cache/bin/go-ast', []],
  '.rs': ['services/code-review/ast/rust/target/release/code-eer-rust-ast', []],
  '.java': [process.env.CODE_EER_JAVA ?? (existsSync('.cache/toolchains/java/Contents/Home/bin/java')
    ? '.cache/toolchains/java/Contents/Home/bin/java' : 'java'),
    ['-cp', ['services/code-review/ast/java/build', '.cache/jars/*'].join(delimiter), 'eer.Main']],
};
const lineCount = (source) => source.endsWith('\n') ? source.split('\n').length - 1 : source.split('\n').length;
async function checkJavaScript(api, path, source) {
  await using lease = await api.createSourceFile(resolve(path), source);
  const walk = (node) => {
    if (isFunctionLikeDeclaration(node)) {
      const length = lineCount(source.slice(node.getStart(lease.sourceFile), node.end));
      if (length > 40) violations.push(`${path}:${lease.sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}: function ${length} lines`);
    }
    node.forEachChild((child) => { walk(child); });
  };
  walk(lease.sourceFile);
}
function checkNative(path, source, command) {
  const response = spawnSync(command[0], command[1], { cwd: root, input: JSON.stringify({ path, source }), encoding: 'utf8' });
  if (response.status !== 0) throw new Error(`${path}: ${response.stderr || response.error}`);
  const result = JSON.parse(response.stdout);
  for (const node of result.nodes) {
    if (!['function', 'method', 'constructor'].includes(node.type) || node.start === null || node.end === null) continue;
    const text = result.encoding === 'utf8' ? Buffer.from(source).subarray(node.start, node.end).toString() : source.slice(node.start, node.end);
    const length = lineCount(text);
    if (length > 40) violations.push(`${path}: ${node.name ?? node.id}: function ${length} lines`);
  }
}
await using api = new API();
for (const path of files) {
  if (/(-lock\.json|Cargo\.lock)$/.test(path)) continue;
  await access(path);
  const source = await readFile(path, 'utf8');
  const length = lineCount(source);
  if (length > 300) violations.push(`${path}: file ${length} lines`);
  const extension = extname(path);
  if (['.ts', '.js', '.mjs', '.tsx', '.jsx'].includes(extension)) await checkJavaScript(api, path, source);
  else if (native[extension]) checkNative(path, source, native[extension]);
}
if (violations.length) { console.error(violations.join('\n')); process.exitCode = 1; }
else console.log(`Checked file and function limits in ${files.length} files.`);
