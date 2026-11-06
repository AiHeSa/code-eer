import * as ts from 'typescript/ast';

interface Scope { parent: Scope | undefined; hoist: boolean; bindings: Map<string, ts.Identifier> }
export interface ScopeResolver { resolve(node: ts.Node, name: string): ts.Identifier | undefined }

export function bindingNames(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name];
  return name.elements.flatMap((entry) => ts.isBindingElement(entry) && entry.name ? bindingNames(entry.name) : []);
}

function functionScope(scope: Scope): Scope {
  while (!scope.hoist && scope.parent) scope = scope.parent;
  return scope;
}

function declaresScope(node: ts.Node): boolean {
  return ts.isFunctionLikeDeclaration(node) || ts.isBlock(node) || ts.isModuleBlock(node)
    || ts.isCatchClause(node) || ts.isForStatement(node) || ts.isForInStatement(node)
    || ts.isForOfStatement(node) || ts.isCaseBlock(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)
    || ts.isClassStaticBlockDeclaration(node);
}

function bind(scope: Scope, names: ts.Identifier[]): void {
  for (const name of names) scope.bindings.set(name.text, name);
}

function addDeclarations(node: ts.Node, scope: Scope): void {
  if (ts.isFunctionLikeDeclaration(node)) {
    for (const parameter of node.parameters) bind(scope, bindingNames(parameter.name));
    if (ts.isFunctionExpression(node) && node.name) bind(scope, [node.name]);
  }
  if (ts.isClassExpression(node) && node.name) bind(scope, [node.name]);
  if (ts.isVariableDeclaration(node)) {
    const blockScoped = !ts.isVariableDeclarationList(node.parent) || Boolean(node.parent.flags & ts.NodeFlags.BlockScoped);
    bind(blockScoped ? scope : functionScope(scope), bindingNames(node.name));
  }
  if (ts.isImportClause(node) && node.name) bind(scope, [node.name]);
  if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node) || ts.isImportEqualsDeclaration(node)) bind(scope, [node.name]);
  if (ts.isEnumDeclaration(node) && node.name) bind(scope, [node.name]);
  if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) bind(scope, [node.name]);
}

export function createScopeResolver(file: ts.SourceFile): ScopeResolver {
  const root: Scope = { parent: undefined, hoist: true, bindings: new Map() };
  const scopes = new Map<ts.Node, Scope>();
  const walk = (node: ts.Node, enclosing: Scope): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) bind(enclosing, [node.name]);
    const scope = declaresScope(node) ? { parent: enclosing,
      hoist: ts.isFunctionLikeDeclaration(node) || ts.isModuleBlock(node) || ts.isClassStaticBlockDeclaration(node)
        || ts.isBlock(node) && ts.isFunctionLikeDeclaration(node.parent),
      bindings: new Map<string, ts.Identifier>() } : enclosing;
    scopes.set(node, scope);
    addDeclarations(node, scope);
    node.forEachChild((child) => { walk(child, scope); });
  };
  walk(file, root);
  return { resolve: (node, name) => {
    let scope = scopes.get(node);
    while (scope) {
      const declaration = scope.bindings.get(name);
      if (declaration) return declaration;
      scope = scope.parent;
    }
    return undefined;
  } };
}
