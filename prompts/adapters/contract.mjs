import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Native adapters load the same stage projections as Skills, without asking the model to select a Skill first. */
export function loadContract(root) {
    const policy = JSON.parse(readFileSync(new URL('quality.json', root), 'utf8'));
    if (policy.format !== 1 || policy.mode !== 'harness-injection') throw new Error('Unsupported EER injection bundle');
    const inject = 'guidance/eer-inject/';
    const check = 'guidance/eer-check/';
    const text = [
        `# EER quality context\n\n[code-eer:harness-injection source=${policy.sourceDigest}]`,
        'Apply the following rules only to applicable source-code work. Documentation-only work is excluded. Injection is automatic; quality review remains advisory. This context does not install a commit gate or an automatic evaluator.',
        body(checked(root, policy, `${inject}SKILL.md`), new URL(inject, root)),
        checked(root, policy, `${inject}references/workflow.md`),
        checked(root, policy, `${inject}references/common.md`),
        body(checked(root, policy, `${check}SKILL.md`), new URL(check, root)),
    ].join('\n\n');

    // Refuse oversized contracts rather than silently discarding applicability conditions or exceptions.
    if (Buffer.byteLength(text, 'utf8') > 24000) throw new Error('EER injection exceeds the 24 KB contract budget');
    return text + '\n';
}

function checked(root, policy, name) {
    const text = readFileSync(new URL(name, root), 'utf8');
    const actual = createHash('sha256').update(text).digest('hex');
    if (policy.files[name] !== actual) throw new Error(`EER guidance changed; rebuild the bundle: ${name}`);
    return text;
}

function body(text, root) {
    return text.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/\]\((references\/[^)]+)\)/g, (_, path) => {
        const target = fileURLToPath(new URL(path, root));
        return `](<${target}>)`;
    });
}
