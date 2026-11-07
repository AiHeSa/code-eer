import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildBundle } from '../prompts/generators/build.mjs';
import { installBundle, uninstallBundle } from '../prompts/generators/install.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    harness: { type: 'string' }, project: { type: 'string' }, targets: { type: 'string' },
    output: { type: 'string' }, apply: { type: 'boolean', default: false }, help: { type: 'boolean' },
  } });
  const [command] = positionals;
  if (values.help || !command) { help(); return; }
  if (positionals.length !== 1 || !['build', 'install', 'uninstall'].includes(command)) throw new Error('Unknown command; use --help');
  if (command !== 'build' && !values.project) throw new Error('--project is required');
  if (command === 'uninstall') {
    if (values.harness || values.targets || values.output) throw new Error('uninstall only accepts --project and --apply');
    console.log(JSON.stringify(await uninstallBundle(resolve(values.project), { apply: values.apply }), null, 2)); return;
  }
  const bundle = await buildBundle(repository, { harness: values.harness,
    ...(values.targets === undefined ? {} : { targets: values.targets.split(',').filter(Boolean) }) });
  if (command === 'install') {
    if (values.output) throw new Error('--output is only supported by build');
    console.log(JSON.stringify(await installBundle(resolve(values.project), bundle, { apply: values.apply }), null, 2));
  } else {
    if (values.apply) throw new Error('build does not accept --apply');
    if (values.output) await writeBuild(resolve(values.output), bundle);
    console.log(JSON.stringify(bundle.manifest, null, 2));
  }
}

async function writeBuild(output, bundle) {
  await mkdir(output, { recursive: false });
  for (const [name, content] of bundle.files) {
    const path = resolve(output, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, content);
  }
  await writeFile(resolve(output, 'AGENTS.fragment.md'), bundle.guidance);
}

function help() {
  console.log('npm run prompts -- build --harness codex|dsh [--targets ts,react] [--output NEW_DIRECTORY]\n'
    + 'npm run prompts -- install --harness codex|dsh --project PATH [--targets ts,react] [--apply]\n'
    + 'npm run prompts -- uninstall --project PATH [--apply]\n'
    + 'Install/uninstall preview by default. --apply writes managed files. Advisory skills only; no automatic review hooks.');
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
