import { dirname, join, relative } from 'node:path';
import { readSource } from '../../internal/ast/paths.js';
import type { AnalyzeParams } from '../../internal/ast/protocol.js';

export async function projectFramework(path: string, params: AnalyzeParams): Promise<'react' | 'vue' | undefined> {
  if (params.framework) return params.framework;
  let directory = dirname(path);
  while (!relative(params.root, directory).startsWith('..')) {
    try {
      const input = await readSource(params.root, join(directory, 'package.json'));
      const manifest = JSON.parse(input.source) as Record<string, unknown>;
      const dependencies: Record<string, unknown> = Object.assign({}, manifest['dependencies'], manifest['devDependencies'], manifest['peerDependencies']);
      if (dependencies['react'] && !dependencies['vue']) return 'react';
      if (dependencies['vue'] && !dependencies['react']) return 'vue';
      if (dependencies['react'] && dependencies['vue']) return undefined;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (directory === params.root) break;
    directory = dirname(directory);
  }
  return undefined;
}
