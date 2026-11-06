import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { matchesGlob } from 'node:path';
import { ProtocolError, type AnalyzeParams } from './protocol.js';
import type { Language } from './schema.js';

const extensions: Record<Language, string[]> = {
  'js-ts': ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.vue'],
  python: ['.py', '.pyi'], java: ['.java'], go: ['.go'], rust: ['.rs'],
};
const ignored = new Set(['node_modules', '.git', '.cache', '.venv', 'venv', 'vendor', 'dist', 'build', 'target', '__pycache__']);
export function languageFor(path: string): Language | undefined {
  return (Object.keys(extensions) as Language[]).find((language) => extensions[language].includes(extname(path)));
}
export async function safePath(root: string, target: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const candidate = resolve(canonicalRoot, target);
  const canonical = await realpath(candidate);
  const rel = relative(canonicalRoot, canonical);
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel))
    throw new ProtocolError('PATH_OUTSIDE_ROOT', `Path is outside project root: ${target}`);
  return canonical;
}
export async function readSource(root: string, target: string): Promise<{ path: string; source: string }> {
  const path = await safePath(root, target);
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new ProtocolError('NOT_A_FILE', target);
  if (metadata.size > 4 * 1024 * 1024) throw new ProtocolError('FILE_TOO_LARGE', target);
  const buffer = await readFile(path);
  return { path, source: new TextDecoder('utf-8', { fatal: true }).decode(buffer) };
}
export function included(path: string, params: AnalyzeParams): boolean {
  const parts = path.split(/[\\/]/);
  if (parts.some((part) => ignored.has(part))) return false;
  if (!params.tests && /(^|[/.])(test[s]?|spec)([/.]|$)|_test\.[^/]+$|(^|\/)test_[^/]+\.py$/.test(path)) return false;
  return params.include.some((glob) => matchesGlob(path, glob)) && !params.exclude.some((glob) => matchesGlob(path, glob));
}
export async function discover(params: AnalyzeParams, language: Language): Promise<string[]> {
  if (params.files.length) return params.files;
  const root = await realpath(params.root);
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (languageFor(path) === language && included(relative(root, path), params)) files.push(path);
      if (files.length > 10000) throw new ProtocolError('TOO_MANY_FILES', 'Project exceeds 10000 files');
    }
  };
  await walk(root);
  return files.sort();
}
