import * as ts from 'typescript/ast';
import type { RawNode } from '../../internal/ast/raw.js';
import { importedExpression, reactImports } from './react-imports.js';
import { componentEvidence } from './react-components.js';
import type { ScopeResolver } from './scope.js';

function append(nodes: RawNode[], type: RawNode['type'], name: string | null, node: ts.Node,
  file: ts.SourceFile, parent: string | null, data: RawNode['data']): void {
  nodes.push({ id: String(nodes.length), parent, type, name, nativeType: ts.SyntaxKind[node.kind],
    start: node.getStart(file), end: node.end, parameters: [], returns: [], async: false,
    bodyStart: null, bodyEnd: null, role: 'framework', data });
}

export function addReact(file: ts.SourceFile, nodes: RawNode[], originals: Map<string, ts.Node>,
  resolver: ScopeResolver, explicit?: 'react' | 'vue', project?: 'react' | 'vue'): 'react' | 'vue' | null {
  const names = reactImports(file);
  const detected = file.statements.some((node) => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
    && /^react(?:\/|$)/.test(node.moduleSpecifier.text));
  if (explicit === 'vue') return 'vue';
  if (!explicit && !detected && file.statements.some((node) => ts.isImportDeclaration(node)
    && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === 'vue')) return 'vue';
  if (explicit !== 'react' && !detected && project !== 'react') return project ?? null;
  const reverse = new Map([...originals].map(([id, node]) => [node, id]));
  for (const fact of [...nodes]) {
    const node = originals.get(fact.id);
    const evidence = node ? componentEvidence(fact, node, names, resolver) : undefined;
    if (node && evidence) append(nodes, 'component', evidence.name, node, file, fact.parent, {
      declarationId: fact.id, evidence: evidence.evidence, certainty: 'candidate' });
  }
  const walk = (node: ts.Node, parent: string | null): void => {
    const container = reverse.get(node) ?? parent;
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(file);
      const imported = importedExpression(node.expression, names, resolver);
      if (/^use[A-Z]/.test(imported?.imported ?? name))
        append(nodes, 'binding', name, node, file, container, {
          usage: 'hookCandidate', source: imported?.source ?? null, imported: imported?.imported ?? null,
          bindingResolution: 'syntax', arguments: node.arguments.map((item) => item.getText(file)) });
    }
    node.forEachChild((child) => { walk(child, container); });
  };
  walk(file, null);
  return 'react';
}
