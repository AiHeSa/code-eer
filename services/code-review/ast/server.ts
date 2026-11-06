import { languageSchema, VERSION, factTypes } from '../internal/ast/schema.js';
import { serveParser } from '../internal/ast/worker.js';
import { nativeParser } from './native-parsers.js';
import { coverageFor, syntaxFor } from '../internal/ast/coverage.js';

const language = languageSchema.parse(process.argv[2]);
if (language === 'js-ts') {
  const { parseJavaScript } = await import('./js-ts/vue.js');
  const { tsVersion } = await import('./js-ts/parser.js');
  const { projectFiles } = await import('./js-ts/project-files.js');
  serveParser({ language, parse: parseJavaScript, files: projectFiles, capabilities: async () => ({
    schemaVersion: VERSION, backend: language, version: tsVersion, runtime: process.version,
    available: true, capabilities: ['syntax', 'structure', 'framework'], factTypes: [...factTypes],
    frameworks: ['react', 'vue'], errors: [],
    coverage: coverageFor(language), syntax: syntaxFor(language, tsVersion),
    frameworkCoverage: { react: coverageFor(language, 'react'), vue: coverageFor(language, 'vue') },
  }) });
} else serveParser(nativeParser(language));
