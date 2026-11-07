import { buildBundle } from './build.mjs';
import { digest, sourceText } from './files.mjs';

const packageRoot = 'plugins/eer-quality';
const json = (value) => JSON.stringify(value, null, 4) + '\n';

/** Export an opt-in native package; building never installs or enables it in a user profile. */
export async function buildHarnessBundle(repository, options) {
    const bundle = await buildBundle(repository, options);
    const { harness } = bundle.manifest;
    const native = new Map();
    for (const [name, text] of bundle.files) {
        if (name.startsWith('.agents/skills/')) native.set(name.replace('.agents/skills/', 'guidance/'), text);
    }
    const manifest = {
        ...bundle.manifest,
        mode: 'harness-injection',
        enabledByDefault: false,
        reviewMode: 'advisory',
        files: Object.fromEntries([...native].map(([name, text]) => [name, digest(text)])),
    };
    native.set('quality.json', json(manifest));
    native.set('contract.mjs', await sourceText(repository, 'prompts/adapters/contract.mjs'));
    native.set('README.md', await sourceText(repository, `prompts/adapters/${harness}/harness.md`));
    if (harness === 'codex') await codexFiles(repository, native);
    else await dshFiles(repository, native);

    const files = new Map([...native].map(([name, text]) => [`${packageRoot}/${name}`, text]));
    if (harness === 'codex') files.set('.agents/plugins/marketplace.json', marketplace());
    return { files, manifest };
}

async function codexFiles(repository, files) {
    files.set('hook.mjs', await sourceText(repository, 'prompts/adapters/codex/hook.mjs'));
    files.set(
        '.codex-plugin/plugin.json',
        json({
            name: 'eer-quality',
            version: '0.1.0',
            description: 'Opt-in EER quality context injection; advisory review.',
            hooks: './hooks/hooks.json',
        }),
    );
    const command = 'node "${PLUGIN_ROOT}/hook.mjs"';
    const handler = { type: 'command', command, timeout: 10, additionalContextLimit: 50000 };
    files.set(
        'hooks/hooks.json',
        json({
            hooks: Object.fromEntries(
                ['SessionStart', 'SubagentStart', 'UserPromptSubmit'].map((event) => [event, [{ hooks: [handler] }]]),
            ),
        }),
    );
}

async function dshFiles(repository, files) {
    files.set('index.mjs', await sourceText(repository, 'prompts/adapters/dsh/plugin.mjs'));
    files.set(
        'package.json',
        json({
            name: '@code-eer/dsh-quality-injection',
            version: '0.1.0',
            private: true,
            type: 'module',
            description: 'Opt-in EER quality context injection; advisory review.',
            exports: { '.': './index.mjs', './locale/*.json': './locale/*.json', './icon': './icon.svg' },
            files: ['*.mjs', 'quality.json', 'guidance', 'cordis.patch.yml', 'locale', 'icon.svg', 'README.md'],
            dsh: { bundle: { patch: './cordis.patch.yml', listedByDefault: false } },
        }),
    );
    files.set(
        'cordis.patch.yml',
        '- insert:\n    - id: code-eer-quality-injection\n      name: "@code-eer/dsh-quality-injection"\n      disabled: true\n',
    );
    displayFiles(files);
}

function displayFiles(files) {
    files.set(
        'locale/en.json',
        json({
            meta: {
                title: 'EER quality injection',
                description: 'Inject coding constraints before model requests. Review remains advisory.',
            },
        }),
    );
    files.set(
        'locale/zh.json',
        json({
            meta: {
                title: 'EER 质量注入',
                description: '在模型请求前注入编码约束；质量检查保持建议式。',
            },
        }),
    );
    // Original, self-contained icon: a contract sheet with a check mark.
    files.set(
        'icon.svg',
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="10" y="5" width="44" height="54" rx="8" fill="#176b59"/><path d="M21 19h22M21 28h16M21 40l8 8 15-16" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>\n',
    );
}

function marketplace() {
    return json({
        name: 'code-eer-local',
        interface: { displayName: 'EER quality injection' },
        plugins: [
            {
                name: 'eer-quality',
                source: { source: 'local', path: `./${packageRoot}` },
                policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
                category: 'Productivity',
            },
        ],
    });
}
