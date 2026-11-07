import { loadContract } from './contract.mjs';

const events = new Set(['SessionStart', 'SubagentStart', 'UserPromptSubmit']);

try {
    let input = '';
    for await (const chunk of process.stdin) {
        input += chunk;
        if (Buffer.byteLength(input, 'utf8') > 1024 * 1024) throw new Error('EER hook input exceeds 1 MB');
    }
    const { hook_event_name: event } = JSON.parse(input);
    if (!events.has(event)) throw new Error(`Unsupported EER hook event: ${event}`);
    const additionalContext = loadContract(new URL('./', import.meta.url));
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext } }));
} catch (error) {
    // Ordinary hook errors are surfaced by Codex; they must not masquerade as a successful injection.
    console.error(`EER injection failed: ${error.message}`);
    process.exitCode = 1;
}
