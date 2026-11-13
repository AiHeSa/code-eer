import { extractIdentifiers, isSimpleIdentifier, NodeTypes, walkIdentifiers } from '@vue/compiler-dom';
import type { ExpressionNode } from '@vue/compiler-dom';

type Identifier = { name: string; start: number; end: number };

export function templateIdentifiers(expression: ExpressionNode | undefined, parameters = false) {
    const declarations: Identifier[] = [];
    const references: Identifier[] = [];
    if (expression?.type !== NodeTypes.SIMPLE_EXPRESSION || expression.isStatic)
        return { declarations, references, incomplete: false };

    const { ast, content, loc } = expression;
    if (!content.trim()) return { declarations, references, incomplete: false };
    const dynamicArgument = loc.source === `[${content}]`;
    if (ast === false || (loc.source !== content && !dynamicArgument))
        return { declarations, references, incomplete: true };

    const offset = loc.start.offset + (dynamicArgument ? 1 : 0);
    if (!ast) {
        if (isSimpleIdentifier(content) && !['true', 'false', 'null', 'this'].includes(content))
            (parameters ? declarations : references).push({
                name: content,
                start: offset,
                end: offset + content.length,
            });
        return { declarations, references, incomplete: false };
    }

    const project = (identifier: { name: string; start?: number | null; end?: number | null }): Identifier => ({
        name: identifier.name,
        start: offset + identifier.start! - 1,
        end: offset + identifier.end! - 1,
    });
    if (parameters && ast.type === 'ArrowFunctionExpression')
        for (const param of ast.params) declarations.push(...extractIdentifiers(param).map(project));

    const declared = new Set(declarations.map((identifier) => identifier.start));
    if (ast.type !== 'Program' || ast.body.length)
        walkIdentifiers(ast, (identifier) => {
            const reference = project(identifier);
            if (!declared.has(reference.start)) references.push(reference);
        });
    return { declarations, references, incomplete: false };
}

export type TemplateIdentifier = Identifier;

export function hasEventParameter(expression: ExpressionNode | undefined): boolean {
    if (expression?.type !== NodeTypes.SIMPLE_EXPRESSION) return false;
    const kind = expression.ast ? expression.ast.type : undefined;
    return !(
        isSimpleIdentifier(expression.content) ||
        kind === 'Identifier' ||
        kind === 'MemberExpression' ||
        kind === 'OptionalMemberExpression' ||
        kind === 'FunctionExpression' ||
        kind === 'ArrowFunctionExpression'
    );
}
