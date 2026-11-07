import { named, children, descendants, type SyntaxNode } from '../ast/tree-runtime.js';
import { parseTree } from '../ast/tree.js';
import { profiles, child, bindingNames, type NativeLanguage } from '../assessment/native-profile.js';
import { nativeId } from '../assessment/native-context.js';
import type { CollectedFile } from './project.js';
import type { Value } from './cost-expressions.js';

export type ExpressionModel =
    | { kind: 'value'; value: Value }
    | { kind: 'ref'; id: string }
    | { kind: 'binary'; op: string; left: ExpressionModel; right: ExpressionModel }
    | { kind: 'call'; id: string; args: ExpressionModel[] };

export type StatementModel =
    | { kind: 'value' | 'return'; value: ExpressionModel }
    | { kind: 'sequence'; items: StatementModel[] }
    | { kind: 'declare'; id: string; value: ExpressionModel }
    | { kind: 'if'; condition: ExpressionModel; yes: StatementModel; no: StatementModel };

export interface NativeFunctionModel {
    parameters: { id: string; kind: Value['kind'] }[];
    body: StatementModel | null;
}

function scalarKind(type: string | null | undefined, language: NativeLanguage): Value['kind'] {
    if (!type || language === 'python') return 'unknown';
    if (
        /^(?:u?int(?:8|16|32|64)?|u?size|i(?:8|16|32|64|128)|u(?:8|16|32|64|128)|f(?:32|64)|float(?:32|64)?|double|byte|short|long|int|rune)$/.test(
            type.trim(),
        )
    )
        return 'number';
    if (/^(?:bool|boolean)$/.test(type.trim())) return 'boolean';
    if (language === 'go' && type.trim() === 'string') return 'string';
    const rust = /(?:^|\n|\s)\w+: (i(?:8|16|32|64|128)|u(?:8|16|32|64|128)|[ui]size|f(?:32|64)|bool)\s*$/.exec(type);
    return language === 'rust' && rust ? (rust[1] === 'bool' ? 'boolean' : 'number') : 'unknown';
}

function expression(node: SyntaxNode | null, file: CollectedFile): ExpressionModel | null {
    if (!node) return { kind: 'value', value: { kind: 'unknown', value: null } };
    if (
        ['parenthesized_expression', 'expression_list', 'argument', 'expression_statement'].includes(node.type) &&
        node.namedChildCount === 1
    )
        return expression(named(node)[0]!, file);
    if (
        /^(?:integer|int_literal|integer_literal|decimal_integer_literal|float|float_literal|floating_point_literal)$/.test(
            node.type,
        )
    ) {
        const value = Number(node.text.replaceAll('_', ''));
        return Number.isFinite(value) ? { kind: 'value', value: { kind: 'number', value } } : null;
    }
    if (['true', 'false', 'boolean_literal'].includes(node.type))
        return { kind: 'value', value: { kind: 'boolean', value: node.text === 'true' } };
    if (['none', 'null_literal', 'nil', 'unit_expression'].includes(node.type))
        return { kind: 'value', value: { kind: 'null', value: null } };
    if (['identifier', 'self'].includes(node.type)) {
        const reference = file.evidence.references.find((ref) => ref.id === nativeId(node, 'reference'));
        return reference?.targetId ? { kind: 'ref', id: reference.targetId } : null;
    }
    if (['binary_expression', 'binary_operator', 'comparison_operator', 'boolean_operator'].includes(node.type)) {
        const leftNode = child(node, 'left') ?? named(node)[0],
            rightNode = child(node, 'right') ?? named(node).at(-1);
        const left = expression(leftNode ?? null, file),
            right = expression(rightNode ?? null, file);
        const operator =
            child(node, 'operator')?.text ??
            children(node).find(
                (item) =>
                    item.startIndex >= (leftNode?.endIndex ?? 0) &&
                    item.endIndex <= (rightNode?.startIndex ?? 0) &&
                    item.text.trim(),
            )?.text;
        return left && right && operator ? { kind: 'binary', op: operator, left, right } : null;
    }
    if (profiles[file.language as NativeLanguage].calls.includes(node.type) && node.type !== 'macro_invocation') {
        const call = file.evidence.calls.find((call) => call.id === nativeId(node, 'call'));
        const args = named(child(node, 'arguments')).map((arg) => expression(arg, file)) ?? [];
        return call?.kind === 'call' && args.every(Boolean)
            ? { kind: 'call', id: call.id, args: args as ExpressionModel[] }
            : null;
    }
    return null;
}

function statement(node: SyntaxNode, file: CollectedFile): StatementModel | null {
    if (['block', 'statement_list', 'declaration_list'].includes(node.type)) {
        const items = named(node)
            .filter((item) => !item.type.includes('comment'))
            .map((item) => statement(item, file));
        return items.every(Boolean) ? { kind: 'sequence', items: items as StatementModel[] } : null;
    }
    if (['return_statement', 'return_expression'].includes(node.type)) {
        const value = expression(child(node, 'value') ?? named(node)[0] ?? null, file);
        return value ? { kind: 'return', value } : null;
    }
    if (node.type === 'if_statement' || node.type === 'if_expression') {
        const condition = expression(child(node, 'condition'), file),
            yesNode = child(node, 'consequence', 'body'),
            noNode = child(node, 'alternative');
        const yes = yesNode ? statement(yesNode, file) : null,
            no = noNode ? statement(noNode, file) : { kind: 'sequence' as const, items: [] };
        return condition && yes && no ? { kind: 'if', condition, yes, no } : null;
    }
    const names = bindingNames(file.language as NativeLanguage, node);
    const declaration =
        names.length === 1
            ? file.evidence.declarations.find((item) => item.id === nativeId(names[0]!, 'binding'))
            : null;
    if (declaration && profiles[file.language as NativeLanguage].variables.includes(node.type)) {
        const value = expression(child(node, 'value', 'right'), file);
        return value ? { kind: 'declare', id: declaration.id, value } : null;
    }
    if (['local_variable_declaration', 'var_declaration', 'const_declaration'].includes(node.type)) {
        const items = named(node)
            .filter((item) => ['variable_declarator', 'var_spec', 'const_spec'].includes(item.type))
            .map((item) => statement(item, file));
        return items.length && items.every(Boolean) ? { kind: 'sequence', items: items as StatementModel[] } : null;
    }
    const value = expression(node, file);
    return value ? { kind: 'value', value } : null;
}

export async function nativeModels(file: CollectedFile, source: string): Promise<Map<string, NativeFunctionModel>> {
    const language = file.language as NativeLanguage,
        syntax = await parseTree(language, source),
        result = new Map<string, NativeFunctionModel>();
    try {
        for (const node of descendants(syntax.tree.rootNode, profiles[language].functions)) {
            const id = nativeId(node, 'function'),
                body = child(node, 'body');
            const parameters = file.evidence.declarations
                .filter((item) => item.functionId === id && item.kind === 'parameter')
                .map((item) => {
                    const ref = file.semantic?.references.find(
                        (ref) =>
                            ref.name === item.name &&
                            ref.range.start.line === item.range.start.line &&
                            ref.range.start.character <= item.range.start.character &&
                            ref.range.end.character >= item.range.end.character,
                    );
                    return { id: item.id, kind: scalarKind(ref?.type, language) };
                });
            const fn = file.evidence.functions.find((fn) => fn.id === id);
            result.set(id, { parameters, body: body && !fn?.async && !fn?.generator ? statement(body, file) : null });
        }
        return result;
    } finally {
        syntax.dispose();
    }
}
