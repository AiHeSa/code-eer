import { named, children, descendants } from '../ast/tree-runtime.js';
import { parseTree } from '../ast/tree.js';
import { nativeContext, located } from './native-context.js';
import { nativeReferences } from './native-references.js';
import { nativeControl } from './native-control.js';
import { profiles, child, type NativeLanguage } from './native-profile.js';
import type { CollectionInput } from './model.js';

export async function collectNative(input: CollectionInput, language: NativeLanguage) {
    const syntax = await parseTree(language, input.source);
    try {
        const context = nativeContext(input, language, syntax.tree.rootNode);
        nativeReferences(context, input);
        nativeControl(context);
        // Dynamic Python namespace writes invalidate every lexical target.
        if (
            context.language === 'python' &&
            context.output.calls.some((call) => ['eval', 'exec', 'globals', 'locals', 'setattr'].includes(call.callee))
        ) {
            for (const ref of context.output.references) {
                ref.dynamicScope = true;
                ref.targetId = null;
            }
            for (const call of context.output.calls) {
                call.targetId = null;
                call.resolution = 'unresolved';
            }
        }
        for (const node of descendants(syntax.tree.rootNode, profiles[language].imports)) {
            const value = child(node, 'module_name', 'path', 'argument') ?? named(node)[0];
            let source = value?.text ?? node.text;
            if (language === 'go')
                try {
                    source = JSON.parse(source) as string;
                } catch {
                    source = source.replace(/^`|`$/g, '');
                }
            context.output.imports.push({ ...located(context, node, 'import'), source, dynamic: false });
        }
        for (const declaration of context.output.declarations.filter((item) => item.exported))
            context.output.exports.push({
                id: `export:${declaration.id}`,
                range: declaration.range,
                name: declaration.name,
            });
        context.output.coverage = {
            level: 'syntax',
            complete: !syntax.tree.rootNode.hasError && !input.file.errors.length && !input.file.diagnostics.length,
            limitations: [
                'Native compiler AST remains the structural source; Tree-sitter projects lexical syntax facts',
                'Compiler/language-server definitions and types are separate evidence; dynamic dispatch and resource lifetimes require proof',
                ...(syntax.tree.rootNode.hasError
                    ? ['Supplementary syntax grammar cannot project all source constructs']
                    : []),
            ],
        };
        return context.output;
    } finally {
        syntax.dispose();
    }
}
