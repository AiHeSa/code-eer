import { API, JsxEmit, type Diagnostic, type RawCompilerOptions } from 'typescript/async';
import { createFileSystemWithLib } from 'typescript/fs';
import { ScriptTarget } from 'typescript/proto';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { safePath } from '../../internal/ast/paths.js';
import { rawResultSchema, type RawResult } from '../../internal/ast/raw.js';
import type { AnalyzeParams } from '../../internal/ast/protocol.js';
import { extract } from './extract.js';
import { addReact } from './react.js';
import { addVueScript } from './vue-script.js';
import { projectFramework } from './framework-project.js';
import { syntaxFor } from '../../internal/ast/coverage.js';

const require = createRequire(import.meta.url);
export const tsVersion: string = (require('typescript/package.json') as { version: string }).version;
function diagnostics(items: readonly Diagnostic[]): RawResult['diagnostics'] {
  return items.map((item) => ({ code: `TS${item.code}`, message: item.text,
    start: item.pos >= 0 ? item.pos : null, end: item.end >= 0 ? item.end : null }));
}
export async function parseScript(path: string, source: string, params: AnalyzeParams, setup = false): Promise<RawResult> {
  await using api = new API();
  const skipped: RawResult['skipped'] = [];
  let options: RawCompilerOptions = {};
  if (params.config.tsconfig) {
    const configPath = await safePath(params.root, resolve(params.root, params.config.tsconfig));
    const config = await api.parseConfigFile(configPath);
    options = config.options;
    skipped.push(...config.errors.filter((error) => error.code !== 18003)
      .map((error) => ({ code: `TS_CONFIG_${error.code}`, message: error.text })));
  }
  await using snapshot = await api.createSnapshot({ fileSystem: createFileSystemWithLib([[path, source]]),
    createPrograms: [{ rootFiles: [path], compilerOptions: { ...options, allowJs: true, noEmit: true,
      noResolve: true, jsx: JsxEmit.Preserve } }] });
  const program = snapshot.operation.createdPrograms[0];
  const file = await program.getSourceFile(path);
  if (!file) throw new Error(`TypeScript did not load ${path}`);
  const { nodes, originals, resolver } = extract(file);
  const framework = addReact(file, nodes, originals, resolver, params.framework, await projectFramework(path, params));
  if (framework === 'vue') addVueScript(file, nodes, originals, resolver, setup);
  const syntax = await program.getSyntacticDiagnostics(path);
  return rawResultSchema.parse({ version: tsVersion, runtime: process.version, encoding: 'utf16',
    syntax: { ...syntaxFor('js-ts', tsVersion), targetVersion: options.target === undefined ? null : ScriptTarget[options.target] },
    nodes, framework, diagnostics: diagnostics(syntax), skipped, structureComplete: syntax.length === 0 });
}
