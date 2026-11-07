import { loadContract } from './contract.mjs';

export const name = 'eer-quality-injection';
export const inject = ['systemPrompt'];

export function apply(ctx) {
    const text = loadContract(new URL('./', import.meta.url));
    // Required context survives optional-context suppression and complete-system-prompt configurations.
    // DSH supplies it as sourced user context before model admission, including in-process child agents.
    return ctx.systemPrompt.context({
        name: 'code-eer:quality',
        order: 700,
        required: true,
        interpolate: false,
        text,
    });
}
