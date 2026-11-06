import { relative, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { VERSION, type Analysis, type Capabilities, type FileResult, type Issue, type Language } from './schema.js';
import { ProtocolError, type AnalyzeParams } from './protocol.js';
import { discover, included, languageFor, readSource, safePath } from './paths.js';
import { normalize, selectFacts } from './normalize.js';
import type { ParsedResult } from './raw.js';
import { coverageFor, syntaxFor } from './coverage.js';

export interface Parser {
  language: Language;
  capabilities(): Promise<Capabilities>;
  parse(path: string, source: string, params: AnalyzeParams): Promise<ParsedResult>;
  files?(params: AnalyzeParams): Promise<{ files: string[]; skipped: Issue[] }>;
}
function fileFailure(path: string, language: Language, error: unknown): FileResult {
  return { uri: pathToFileURL(path).href, language, framework: null, digest: '', facts: [], diagnostics: [],
    coverage: coverageFor(language), syntax: syntaxFor(language, 'unknown'),
    executed: [], skipped: [], errors: [{ code: error instanceof ProtocolError ? error.code : 'FILE_ERROR',
      message: String(error), range: null }] };
}
async function analyzeFile(parser: Parser, path: string, params: AnalyzeParams): Promise<FileResult[]> {
  try {
    const input = await readSource(params.root, path);
    const raw = await parser.parse(input.path, input.source, params);
    const file = normalize(input.path, input.source, parser.language, raw);
    return [file, ...(raw.relatedFiles ?? [])].map((entry) => applySelection(entry, params));
  } catch (error) { return [fileFailure(path, parser.language, error)]; }
}
function applySelection(file: FileResult, params: AnalyzeParams): FileResult {
  if (!params.capabilities.includes('structure'))
    file.skipped = file.skipped.filter((item) => item.code !== 'STRUCTURE_INCOMPLETE');
  const unsupported = params.capabilities.filter((item) => !file.executed.includes(item));
  file.skipped.push(...unsupported.map((item) => ({ code: 'UNSUPPORTED_CAPABILITY', message: item, range: null })));
  file.facts = params.capabilities.includes('structure') ? selectFacts(file.facts, params.factTypes) : [];
  file.executed = file.executed.filter((item) => params.capabilities.includes(item));
  return file;
}
export async function analyze(parser: Parser, params: AnalyzeParams): Promise<Analysis> {
  params = { ...params, root: await realpath(params.root) };
  const caps = await parser.capabilities();
  const result: Analysis = { schemaVersion: VERSION, backend: parser.language, version: caps.version,
    status: 'complete', files: [], findings: [], errors: [], skipped: [],
    configuration: JSON.parse(JSON.stringify(params)) as Analysis['configuration'] };
  if (!caps.available) return { ...result, status: 'failed', errors: caps.errors };
  const unsupported = (params.factTypes ?? []).filter((type) => !caps.factTypes.includes(type));
  result.skipped.push(...unsupported.map((type) => ({ code: 'UNSUPPORTED_FACT_TYPE', message: type, range: null })));
  let targets: string[];
  try {
    const selection = parser.files ? await parser.files(params) : { files: await discover(params, parser.language), skipped: [] };
    targets = selection.files; result.skipped.push(...selection.skipped);
  } catch (error) { return { ...result, status: 'failed', errors: [{ code: error instanceof ProtocolError
    ? error.code : 'PROJECT_ERROR', message: String(error), range: null }] }; }
  for (const target of targets) {
    let path: string;
    try { path = await safePath(params.root, target); }
    catch (error) { result.files.push(fileFailure(resolve(params.root, target), parser.language, error)); continue; }
    if (languageFor(path) !== parser.language || !included(relative(params.root, path), params)) {
      result.skipped.push({ code: 'FILE_EXCLUDED', message: path, range: null }); continue;
    }
    result.files.push(...await analyzeFile(parser, path, params));
  }
  const incomplete = result.skipped.length > 0 || result.files.some((file) => file.errors.length || file.skipped.length);
  if (incomplete) result.status = result.files.some((file) => file.executed.length) ? 'partial' : 'failed';
  if (!result.files.length && !result.skipped.length) {
    result.status = 'partial';
    result.skipped.push({ code: 'NO_INPUT_FILES', message: 'No matching source files', range: null });
  }
  return result;
}
