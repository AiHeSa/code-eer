import { baseParse, NodeTypes, type RootNode, type TemplateChildNode, type ElementNode } from '@vue/compiler-dom';
import type { RawNode, RawResult } from '../../internal/ast/raw.js';

function append(
    nodes: RawNode[],
    type: RawNode['type'],
    nativeType: string,
    name: string | null,
    start: number,
    end: number,
    parent: string | null,
    data: RawNode['data'] = {},
): string {
    const id = String(nodes.length);
    nodes.push({
        id,
        parent,
        type,
        nativeType,
        name,
        start,
        end,
        parameters: [],
        returns: [],
        async: false,
        bodyStart: null,
        bodyEnd: null,
        role: 'template',
        data,
    });
    return id;
}

function attributes(node: ElementNode, nodes: RawNode[], parent: string, offset: number): void {
    for (const property of node.props) {
        if (property.type === NodeTypes.ATTRIBUTE) {
            append(
                nodes,
                'attribute',
                'AttributeNode',
                property.name,
                offset + property.loc.start.offset,
                offset + property.loc.end.offset,
                parent,
                { value: property.value?.content ?? null },
            );
        } else {
            const id = append(
                nodes,
                'directive',
                'DirectiveNode',
                property.name,
                offset + property.loc.start.offset,
                offset + property.loc.end.offset,
                parent,
                {
                    argument: property.arg?.loc.source ?? null,
                    modifiers: property.modifiers.map((item) => item.content),
                    expression: property.exp?.loc.source ?? null,
                },
            );
            if (property.exp)
                append(
                    nodes,
                    'binding',
                    'SimpleExpressionNode',
                    property.exp.loc.source,
                    offset + property.exp.loc.start.offset,
                    offset + property.exp.loc.end.offset,
                    id,
                    { bindingResolution: 'syntax', directive: property.name },
                );
        }
    }
}

function walk(node: TemplateChildNode, nodes: RawNode[], parent: string, offset: number): void {
    if (node.type === NodeTypes.ELEMENT) {
        const id = append(
            nodes,
            'templateElement',
            'ElementNode',
            node.tag,
            offset + node.loc.start.offset,
            offset + node.loc.end.offset,
            parent,
            { tagType: node.tagType },
        );
        attributes(node, nodes, id, offset);
        node.children.forEach((child) => walk(child, nodes, id, offset));
    } else if (node.type === NodeTypes.INTERPOLATION) {
        append(
            nodes,
            'binding',
            'InterpolationNode',
            node.content.loc.source,
            offset + node.content.loc.start.offset,
            offset + node.content.loc.end.offset,
            parent,
            { bindingResolution: 'syntax', usage: 'interpolation' },
        );
    }
}

export function parseTemplate(
    source: string,
    nodes: RawNode[],
    parent: string,
    offset: number,
): RawResult['diagnostics'] {
    const diagnostics: RawResult['diagnostics'] = [];
    const ast: RootNode = baseParse(source, {
        onError: (error) => {
            diagnostics.push({
                code: `VUE${error.code}`,
                message: error.message,
                start: error.loc ? offset + error.loc.start.offset : null,
                end: error.loc ? offset + error.loc.end.offset : null,
            });
        },
    });
    ast.children.forEach((node) => walk(node, nodes, parent, offset));
    return diagnostics;
}
