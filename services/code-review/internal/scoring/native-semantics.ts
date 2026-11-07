import { named, children, descendants } from '../ast/tree-runtime.js';
import { emptySemantics } from './semantics.js';
import { nativeModels, type StatementModel } from './native-model.js';
import { evaluateNative, nativePurityCandidate } from './native-evaluate.js';
import { parseTree } from '../ast/tree.js';
import type { CollectedFile } from './project.js';
import type { NativeLanguage } from '../assessment/native-profile.js';
import { nativeDependencies } from './native-dependencies.js';

function constants(node: StatementModel | null, output: Set<string>): void {
    if (!node) return;
    if (node.kind === 'declare' && node.value.kind === 'value' && node.value.value.kind !== 'unknown')
        output.add(node.id);
    if (node.kind === 'sequence') for (const item of node.items) constants(item, output);
    if (node.kind === 'if') {
        constants(node.yes, output);
        constants(node.no, output);
    }
}

async function moduleCost(file: CollectedFile, source: string) {
    const syntax = await parseTree(file.language as NativeLanguage, source);
    try {
        const nodes = named(syntax.tree.rootNode).filter((node) => !node.type.includes('comment'));
        if (
            file.language === 'python' &&
            nodes.every((node) =>
                [
                    'function_definition',
                    'import_statement',
                    'import_from_statement',
                    'future_import_statement',
                ].includes(node.type),
            )
        ) {
            const functions = nodes.filter((node) => node.type === 'function_definition');
            const unsafe = functions.some((fn) =>
                named(fn)
                    .filter((node) => node.type !== 'block')
                    .some(
                        (node) =>
                            descendants(node, [
                                'default_parameter',
                                'typed_default_parameter',
                                'call',
                                'attribute',
                                'subscript',
                            ]).length,
                    ),
            );
            if (!unsafe)
                return {
                    time: functions.length * 3,
                    space: functions.length * 3,
                    pure: false,
                    isolated: false,
                    model: 'Python own function definitions and simple annotation reads; imported module execution excluded',
                };
        }
        const permitted: Record<string, string[]> = {
            go: [
                'package_clause',
                'import_declaration',
                'function_declaration',
                'method_declaration',
                'type_declaration',
            ],
            rust: [
                'function_item',
                'use_declaration',
                'impl_item',
                'trait_item',
                'struct_item',
                'enum_item',
                'mod_item',
                'extern_crate_declaration',
            ],
            java: [
                'package_declaration',
                'import_declaration',
                'class_declaration',
                'interface_declaration',
                'record_declaration',
                'enum_declaration',
            ],
            python: [],
        };
        if (!nodes.every((node) => permitted[file.language]!.includes(node.type))) return null;
        if (
            descendants(syntax.tree.rootNode, [
                'field_declaration',
                'static_initializer',
                'static_item',
                'const_item',
                'decorator',
            ]).length
        )
            return null;
        return {
            time: 0,
            space: 0,
            pure: false,
            isolated: false,
            model: 'native own module has declarations only; imported initialization excluded',
        };
    } finally {
        syntax.dispose();
    }
}

export async function deriveNativeSemantics(file: CollectedFile, source: string, root: string) {
    const result = emptySemantics();
    result.nativeModels = await nativeModels(file, source);
    result.moduleCost = await moduleCost(file, source);
    result.exportsComplete = false;
    result.completeImports = file.semantic?.status === 'complete';
    for (const [id, model] of result.nativeModels) {
        const cost = evaluateNative(model, () => null);
        if (cost) result.costs.set(id, cost);
        if (nativePurityCandidate(model)) result.localPure.add(id);
        result.parameterCounts.set(id, model.parameters.length);
        constants(model.body, result.primitiveBindings);
    }
    result.dependencies = nativeDependencies(file, root);
    return result;
}
