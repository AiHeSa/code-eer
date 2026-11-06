import { resolve } from 'node:path';
import { git, repositoryFiles } from './capabilities/repository.mjs';
import { checkInheritance } from './capabilities/check.mjs';
import { typecheckSnapshot } from './capabilities/typecheck.mjs';

try {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--staged')) throw new Error('Usage: node scripts/check-inheritance.mjs [--staged]');
  const root = resolve(git(process.cwd(), ['rev-parse', '--show-toplevel']).trim());
  const staged = args.includes('--staged');
  const files = await repositoryFiles(root, staged);
  const result = await checkInheritance(files);
  await typecheckSnapshot(root, files, result.roots);
  console.log(`Inheritance check passed (${staged ? 'index' : 'working tree'}): ${result.families} families, ${result.specializations} specializations; typecheck passed.`);
} catch (error) { console.error(String(error)); process.exitCode = 1; }
