import { join, delimiter } from 'node:path';
import { existsSync } from 'node:fs';
import { runNative } from '../internal/ast/native.js';
import { repositoryRoot } from '../internal/ast/root.js';
import { VERSION, type Capabilities, type Language } from '../internal/ast/schema.js';
import type { Command } from '../internal/ast/process.js';
import type { Parser } from '../internal/ast/worker-analysis.js';
import { coverageFor, syntaxFor } from '../internal/ast/coverage.js';
import { semanticAvailable } from '../internal/ast/semantic.js';

const probes: Record<string, string> = { python: 'def probe(): pass', java: 'class Probe {}',
  go: 'package probe\nfunc Probe() {}', rust: 'fn probe() {}' };
export function nativeCommand(language: Language): Command {
  const root = repositoryRoot();
  const base = join(root, 'services/code-review/ast');
  if (language === 'python') {
    const local = join(root, '.cache/toolchains/python/bin/python3');
    return { command: process.env['CODE_EER_PYTHON'] ?? (existsSync(local) ? local : 'python3'), args: [join(base, 'python/parser.py')] };
  }
  if (language === 'go') return { command: join(root, '.cache/bin/go-ast'), args: [] };
  if (language === 'rust') return { command: join(base, 'rust/target/release/code-eer-rust-ast'), args: [] };
  const local = join(root, '.cache/toolchains/java/Contents/Home/bin/java');
  return { command: process.env['CODE_EER_JAVA'] ?? (existsSync(local) ? local : 'java'),
    args: ['-cp', [join(base, 'java/build'), join(root, '.cache/jars/*')].join(delimiter), 'eer.Main'] };
}

export function nativeParser(language: Language): Parser {
  const command = nativeCommand(language);
  let available: Promise<Capabilities> | undefined;
  const probe = async (): Promise<Capabilities> => {
    const base: Capabilities = { schemaVersion: VERSION, backend: language, version: 'unknown', runtime: 'unknown',
      available: false, capabilities: ['syntax', 'structure', ...(semanticAvailable(language) ? ['symbols' as const, 'types' as const] : [])],
      factTypes: language === 'java' ? ['method', 'constructor', 'function', 'type', 'import', 'export', 'module']
        : language === 'python' ? ['function', 'method', 'type', 'import'] : ['function', 'method', 'type', 'import', 'module'],
      frameworks: [], errors: [], coverage: coverageFor(language), syntax: syntaxFor(language, 'unknown'), frameworkCoverage: {} };
    try {
      const raw = await runNative(command, { path: 'probe', source: probes[language] });
      return { ...base, available: true, version: raw.version, runtime: raw.runtime, syntax: syntaxFor(language, raw.version) };
    } catch (error) { return { ...base, errors: [{ code: 'BACKEND_UNAVAILABLE', message: String(error), range: null }] }; }
  };
  return { language, capabilities: () => available ??= probe(),
    parse: async (path, source, params) => {
      const result = await runNative(command, { path, source, config: params.config });
      result.syntax = syntaxFor(language, result.version, params.config);
      if (language === 'rust' && params.config.rustEdition) result.skipped.push({
        code: 'EDITION_NOT_ENFORCED', message: `syn syntax analysis does not enforce edition ${params.config.rustEdition}` });
      return result;
    } };
}
