import { TypeFlags, type Project, type Type } from 'typescript/async';
import * as ts from 'typescript/ast';
import { sourceLocator } from './tree.js';
import { typescriptDefinition } from './semantic-typescript-location.js';
import type { FrameworkBinding, ReactSemantics } from './semantic-schema.js';

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
type Locate = ReturnType<typeof sourceLocator>;

async function jsxAttribute(
    attribute: ts.JsxAttribute,
    props: Type | undefined,
    project: Project,
    file: ts.SourceFile,
    locate: Locate,
): Promise<FrameworkBinding> {
    const name = attribute.name.getText(file);
    const checker = project.checker;
    const [symbol, type] = props
        ? await Promise.all([checker.getPropertyOfType(props, name), checker.getTypeOfPropertyOfType(props, name)])
        : [];
    return {
        name,
        range: locate(attribute.name.getStart(file), attribute.name.end),
        definition: symbol ? await typescriptDefinition(symbol, project) : null,
        type: type && !type.isErrorType() ? await checker.typeToString(type, attribute) : null,
    };
}

async function jsxElement(
    node: Opening,
    project: Project,
    file: ts.SourceFile,
    locate: Locate,
): Promise<ReactSemantics['elements'][number]> {
    const tag = node.tagName;
    const name = tag.getText(file);
    const kind = ts.isJsxNamespacedName(tag)
        ? 'namespaced'
        : ts.isIdentifier(tag) && (/^[a-z]/.test(name) || name.includes('-'))
          ? 'intrinsic'
          : 'component';
    const checker = project.checker;
    const [symbol, tagType, context] = await Promise.all([
        checker.getSymbolAtLocation(ts.isPropertyAccessExpression(tag) ? tag.name : tag),
        kind === 'component' ? checker.getTypeAtLocation(tag) : undefined,
        checker.getContextualType(node.attributes),
    ]);
    const props = context && !context.isErrorType() && !(context.flags & TypeFlags.Unknown) ? context : undefined;
    return {
        kind,
        name,
        range: locate(tag.getStart(file), tag.end),
        definition: symbol ? await typescriptDefinition(symbol, project) : null,
        type: tagType && !tagType.isErrorType() ? await checker.typeToString(tagType, tag) : null,
        propsType: props ? await checker.typeToString(props, node) : null,
        attributes: await Promise.all(
            node.attributes.properties
                .filter(ts.isJsxAttribute)
                .map((attribute) => jsxAttribute(attribute, props, project, file, locate)),
        ),
    };
}

export async function reactSemantics(file: ts.SourceFile, project: Project): Promise<ReactSemantics> {
    const nodes: Opening[] = [];
    const walk = (node: ts.Node): void => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) nodes.push(node);
        node.forEachChild(walk);
    };
    walk(file);
    const locate = sourceLocator(file.text);
    const elements: ReactSemantics['elements'] = [];
    for (const node of nodes) elements.push(await jsxElement(node, project, file, locate));
    return { kind: 'react', elements };
}
