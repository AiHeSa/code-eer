import {
    ElementTypes,
    NodeTypes,
    isCoreComponent,
    parse,
    parserOptions,
    type DirectiveNode,
    type ElementNode,
    type ExpressionNode,
    type TemplateChildNode,
} from '@vue/compiler-dom';
import type { FrameworkBinding, VueSemantics } from './semantic-schema.js';
import { sourceLocator } from './tree.js';
import { hasEventParameter, templateIdentifiers, type TemplateIdentifier } from './semantic-vue-expressions.js';

type BindingKind = VueSemantics['bindings'][number]['kind'];
type Binding = Pick<FrameworkBinding, 'definition' | 'type'> & { kind: BindingKind };
export type SetupBinding = Binding & { componentDefinition: FrameworkBinding['definition'] };
type Scope = ReadonlyMap<string, Binding>;

const globals = new Set(
    'Infinity undefined NaN isFinite isNaN parseFloat parseInt decodeURI decodeURIComponent encodeURI encodeURIComponent Math Number Date Array Object Boolean String RegExp Map Set JSON Intl BigInt console Error Symbol'.split(
        ' ',
    ),
);

function componentBinding(name: string, setup: ReadonlyMap<string, SetupBinding>) {
    const camel = name.replace(/-(\w)/g, (_, char: string) => char.toUpperCase());
    const pascal = camel.charAt(0).toUpperCase() + camel.slice(1);
    for (const spelling of [name, camel, pascal]) if (setup.has(spelling)) return setup.get(spelling);
    return undefined;
}

function templateEvidence(source: string, offset: number, uri: string) {
    const result: VueSemantics = { kind: 'vue', bindings: [], components: [] };
    let incomplete = false;
    const locate = sourceLocator(source);
    const rangeOf = (id: TemplateIdentifier) => locate(offset + id.start, offset + id.end);
    const markIncomplete = () => {
        incomplete = true;
    };

    const reference = (id: TemplateIdentifier, scope: Scope, event: boolean) => {
        const range = rangeOf(id);
        const binding: Binding | undefined =
            event && id.name === '$event' ? { kind: 'event', definition: null, type: null } : scope.get(id.name);
        const kind = binding?.kind ?? (globals.has(id.name) ? 'global' : 'unresolved');
        if (kind === 'unresolved') incomplete = true;
        result.bindings.push({
            name: id.name,
            range,
            kind,
            declaration: false,
            definition: binding?.definition ?? null,
            type: binding?.type ?? null,
        });
    };

    const expression = (
        value: ExpressionNode | undefined,
        scope: Scope,
        kind?: 'for' | 'slot',
        event = false,
    ): Scope => {
        const parsed = templateIdentifiers(value, Boolean(kind));
        incomplete ||= parsed.incomplete;
        for (const id of parsed.references) reference(id, scope, event);
        if (!kind || !parsed.declarations.length) return scope;
        const local = new Map(scope);
        for (const id of parsed.declarations) {
            const range = rangeOf(id);
            const binding = { kind, definition: { uri, range }, type: null };
            local.set(id.name, binding);
            result.bindings.push({ name: id.name, range, declaration: true, ...binding });
        }
        return local;
    };

    const component = (node: ElementNode, setup: ReadonlyMap<string, SetupBinding>) => {
        if (
            node.tagType !== ElementTypes.COMPONENT ||
            isCoreComponent(node.tag) ||
            parserOptions.isBuiltInComponent?.(node.tag)
        )
            return;
        const dynamic = node.tag === 'component' || node.tag === 'Component';
        const binding = dynamic ? undefined : componentBinding(node.tag, setup);
        const definition = binding?.componentDefinition ?? null;
        const start = offset + node.loc.start.offset + 1;
        result.components.push({
            name: node.tag,
            range: locate(start, start + node.tag.length),
            definition,
            type: binding?.type ?? null,
        });
        incomplete ||= !definition;
    };

    return { expression, component, markIncomplete, collect: () => ({ result, incomplete }) };
}

type Evidence = ReturnType<typeof templateEvidence>;

function loopScope(loop: DirectiveNode | undefined, outer: Scope, evidence: Evidence): Scope {
    if (!loop) return outer;
    const parsed = loop.forParseResult;
    if (!parsed || loop.exp?.type !== NodeTypes.SIMPLE_EXPRESSION || loop.exp.content !== loop.exp.loc.source) {
        evidence.markIncomplete();
        return outer;
    }
    evidence.expression(parsed.source, outer);
    return [parsed.value, parsed.key, parsed.index].reduce<Scope>(
        (scope, alias) => evidence.expression(alias, scope, 'for'),
        outer,
    );
}

function childScope(props: DirectiveNode[], outer: Scope, evidence: Evidence): Scope {
    const scope = loopScope(
        props.find((prop) => prop.name === 'for'),
        outer,
        evidence,
    );
    let children = scope;
    for (const prop of props) {
        const current = prop.name === 'if' || prop.name === 'else-if' ? outer : scope;
        evidence.expression(prop.arg, current);
        if (prop.name === 'slot') children = evidence.expression(prop.exp, scope, 'slot');
        else if (prop.name !== 'for') {
            const event = prop.name === 'on' && !!prop.arg && hasEventParameter(prop.exp);
            evidence.expression(prop.exp, current, undefined, event);
        }
    }
    return children;
}

export function analyzeVueTemplate(
    template: string,
    offset: number,
    source: string,
    uri: string,
    setup: ReadonlyMap<string, SetupBinding>,
) {
    const evidence = templateEvidence(source, offset, uri);
    const ast = parse(template, { prefixIdentifiers: true, onError: evidence.markIncomplete });
    const walk = (node: TemplateChildNode, outer: Scope): void => {
        if (node.type === NodeTypes.INTERPOLATION) evidence.expression(node.content, outer);
        if (node.type !== NodeTypes.ELEMENT) return;

        const props = node.props.filter((prop): prop is DirectiveNode => prop.type === NodeTypes.DIRECTIVE);
        evidence.component(node, setup);
        const scope = childScope(props, outer, evidence);
        for (const child of node.children) walk(child, scope);
    };

    for (const child of ast.children) walk(child, setup);
    return evidence.collect();
}
