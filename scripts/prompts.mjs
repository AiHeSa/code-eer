import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildBundle } from '../prompts/generators/build.mjs';
import { installBundle, uninstallBundle } from '../prompts/generators/install.mjs';
import { buildHarnessBundle } from '../prompts/generators/harness.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliOptions = {
    harness: { type: 'string' },
    project: { type: 'string' },
    targets: { type: 'string' },
    output: { type: 'string' },
    apply: { type: 'boolean', default: false },
    help: { type: 'boolean' },
};

async function main() {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: cliOptions });
    const [command] = positionals;
    if (values.help || !command) {
        help();
        return;
    }
    if (positionals.length !== 1 || !['build', 'build-harness', 'install', 'uninstall'].includes(command))
        throw new Error('Unknown command; use --help');
    const building = command === 'build' || command === 'build-harness';
    if (!building && !values.project) throw new Error('--project is required');
    if (building && values.project) throw new Error('build commands do not accept --project');
    if (command === 'uninstall') {
        if (values.harness || values.targets || values.output)
            throw new Error('uninstall only accepts --project and --apply');
        console.log(JSON.stringify(await uninstallBundle(resolve(values.project), { apply: values.apply }), null, 2));
        return;
    }
    const build = command === 'build-harness' ? buildHarnessBundle : buildBundle;
    const bundle = await build(repository, {
        harness: values.harness,
        ...(values.targets === undefined ? {} : { targets: values.targets.split(',').filter(Boolean) }),
    });
    if (command === 'install') {
        if (values.output) throw new Error('--output is only supported by build commands');
        console.log(
            JSON.stringify(await installBundle(resolve(values.project), bundle, { apply: values.apply }), null, 2),
        );
    } else {
        if (values.apply) throw new Error('build commands do not accept --apply');
        if (values.output) await writeBuild(resolve(values.output), bundle);
        console.log(JSON.stringify(bundle.manifest, null, 2));
    }
}

async function writeBuild(output, bundle) {
    await mkdir(output, { recursive: false });
    for (const [name, content] of bundle.files) {
        const path = resolve(output, name);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content);
    }
    if (bundle.guidance !== undefined) await writeFile(resolve(output, 'AGENTS.fragment.md'), bundle.guidance);
}

function help() {
    console.log(
        'npm run prompts -- build --harness codex|dsh [--targets ts,react] [--output NEW_DIRECTORY]\n' +
            'npm run prompts -- build-harness --harness codex|dsh [--targets ts,react] [--output NEW_DIRECTORY]\n' +
            'npm run prompts -- install --harness codex|dsh --project PATH [--targets ts,react] [--apply]\n' +
            'npm run prompts -- uninstall --project PATH [--apply]\n' +
            'Install/uninstall preview by default. --apply writes managed skills.\n' +
            'build-harness exports a separate, default-off native package. Users must install and enable it in the host; review stays advisory.',
    );
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
