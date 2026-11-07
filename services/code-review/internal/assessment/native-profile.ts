import { named, children, descendants, type SyntaxNode } from '../ast/tree-runtime.js';
import type { Language } from '../ast/schema.js';

export type NativeLanguage = Exclude<Language, 'js-ts'>;

export interface NativeProfile {
    functions: string[];
    classes: string[];
    blocks: string[];
    loops: string[];
    calls: string[];
    variables: string[];
    parameters: string[];
    imports: string[];
    branches: string[];
}

export const profiles: Record<NativeLanguage, NativeProfile> = {
    python: {
        functions: ['function_definition', 'lambda', 'generator_expression'],
        classes: ['class_definition'],
        blocks: ['list_comprehension', 'set_comprehension', 'dictionary_comprehension'],
        loops: ['for_statement', 'while_statement'],
        calls: ['call'],
        variables: ['assignment', 'augmented_assignment', 'for_statement', 'for_in_clause'],
        parameters: ['parameters', 'lambda_parameters'],
        imports: ['import_statement', 'import_from_statement', 'future_import_statement'],
        branches: [
            'if_statement',
            'elif_clause',
            'match_statement',
            'case_clause',
            'conditional_expression',
            'if_clause',
        ],
    },
    java: {
        functions: [
            'method_declaration',
            'constructor_declaration',
            'compact_constructor_declaration',
            'lambda_expression',
        ],
        classes: [
            'class_declaration',
            'interface_declaration',
            'enum_declaration',
            'record_declaration',
            'annotation_type_declaration',
        ],
        blocks: ['block', 'for_statement', 'enhanced_for_statement', 'catch_clause', 'switch_block'],
        loops: ['for_statement', 'enhanced_for_statement', 'while_statement', 'do_statement'],
        calls: ['method_invocation', 'object_creation_expression', 'explicit_constructor_invocation'],
        variables: ['variable_declarator', 'enhanced_for_statement'],
        parameters: ['formal_parameter', 'spread_parameter', 'catch_formal_parameter', 'inferred_parameters'],
        imports: ['import_declaration'],
        branches: ['if_statement', 'switch_expression', 'switch_label', 'ternary_expression'],
    },
    go: {
        functions: ['function_declaration', 'method_declaration', 'func_literal', 'method_spec', 'method_elem'],
        classes: ['type_spec'],
        blocks: [
            'block',
            'for_statement',
            'if_statement',
            'expression_switch_statement',
            'type_switch_statement',
            'select_statement',
        ],
        loops: ['for_statement'],
        calls: ['call_expression'],
        variables: ['short_var_declaration', 'var_spec', 'const_spec', 'range_clause', 'field_declaration'],
        parameters: ['parameter_declaration', 'variadic_parameter_declaration'],
        imports: ['import_spec'],
        branches: ['if_statement', 'expression_case', 'type_case', 'communication_case'],
    },
    rust: {
        functions: ['function_item', 'function_signature_item', 'closure_expression'],
        classes: ['impl_item', 'trait_item', 'struct_item', 'enum_item', 'union_item'],
        blocks: ['block', 'for_expression', 'if_expression', 'match_arm'],
        loops: ['for_expression', 'while_expression', 'loop_expression'],
        calls: ['call_expression', 'macro_invocation'],
        variables: ['let_declaration', 'const_item', 'static_item', 'for_expression', 'field_declaration'],
        parameters: ['parameter', 'self_parameter', 'closure_parameters'],
        imports: ['use_declaration', 'extern_crate_declaration'],
        branches: ['if_expression', 'match_expression', 'match_arm'],
    },
};
export const child = (node: SyntaxNode, ...fields: string[]) =>
    fields.map((field) => node.childForFieldName(field)).find(Boolean) ?? null;

export function names(node: SyntaxNode | null): SyntaxNode[] {
    if (!node) return [];
    if (['identifier', 'self', 'field_identifier'].includes(node.type)) return [node];
    if (['typed_parameter', 'default_parameter', 'typed_default_parameter'].includes(node.type))
        return names(child(node, 'name') ?? named(node)[0] ?? null);
    if (node.type.includes('type') || node.type === 'attribute' || node.type === 'field_expression') return [];
    return named(node).flatMap(names);
}

export function bindingNames(language: NativeLanguage, node: SyntaxNode, parameter = false): SyntaxNode[] {
    if (language === 'rust' && node.type === 'self_parameter') return descendants(node, ['self', 'identifier']);
    if (language === 'python' && ['parameters', 'lambda_parameters'].includes(node.type))
        return named(node).flatMap(names);
    if (
        (language === 'java' && node.type === 'inferred_parameters') ||
        (language === 'rust' && node.type === 'closure_parameters')
    )
        return names(node);
    if (
        language === 'go' &&
        ['parameter_declaration', 'variadic_parameter_declaration', 'var_spec', 'const_spec'].includes(node.type)
    )
        return named(node).filter((item) => item.type === 'identifier');
    if (language === 'go' && node.type === 'field_declaration')
        return named(node).filter((item) => item.type === 'field_identifier');
    return names(child(node, ...(parameter ? ['name', 'pattern'] : ['name', 'pattern', 'left'])));
}
