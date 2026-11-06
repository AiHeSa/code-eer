import { API } from 'typescript/async';
import { dirname, extname, matchesGlob, relative, resolve, sep } from 'node:path';
import { discover, safePath } from '../../internal/ast/paths.js';
import { ProtocolError, type AnalyzeParams } from '../../internal/ast/protocol.js';
import type { Issue } from '../../internal/ast/schema.js';

function globMatch(path: string, pattern: string, directory: string): boolean {
  const glob = resolve(directory, pattern);
  return matchesGlob(path, glob) || !/[?*[{]/.test(glob) && (path === glob || path.startsWith(glob + sep));
}
function vueIncluded(path: string, directory: string, raw: Record<string, unknown>, outDir?: string): boolean {
  const strings = (key: string) => Array.isArray(raw[key]) ? raw[key].filter((item): item is string => typeof item === 'string') : undefined;
  const explicit = strings('files') ?? [];
  if (explicit.some((file) => resolve(directory, file) === path)) return true;
  if (outDir && (path === outDir || path.startsWith(outDir + sep))) return false;
  const includes = strings('include') ?? (raw['files'] ? [] : ['**/*']);
  const excludes = strings('exclude') ?? [];
  return includes.some((glob) => globMatch(path, glob, directory)) && !excludes.some((glob) => globMatch(path, glob, directory));
}
export async function projectFiles(params: AnalyzeParams): Promise<{ files: string[]; skipped: Issue[] }> {
  const candidates = await discover(params, 'js-ts');
  if (!params.config.tsconfig) return { files: candidates, skipped: [] };
  const configPath = await safePath(params.root, params.config.tsconfig);
  await using api = new API();
  const config = await api.parseConfigFile(configPath);
  const errors = config.errors.filter((error) => error.code !== 18003);
  if (errors.length) throw new ProtocolError('TS_CONFIG_ERROR', errors.map((error) => error.text).join('\n'));
  const roots = new Set(config.fileNames.map((path) => resolve(path)));
  const raw = config.raw && typeof config.raw === 'object' ? config.raw as Record<string, unknown> : {};
  const files: string[] = [], skipped: Issue[] = [];
  for (const candidate of candidates) {
    let path: string;
    try { path = await safePath(params.root, candidate); }
    catch { files.push(candidate); continue; }
    const selected = roots.has(path) || extname(path) === '.vue'
      && vueIncluded(path, dirname(configPath), raw, config.options.outDir);
    if (selected) files.push(path);
    else if (params.files.length) skipped.push({ code: 'TS_CONFIG_EXCLUDED', message: relative(params.root, path), range: null });
  }
  return { files, skipped };
}
