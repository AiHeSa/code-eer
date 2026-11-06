import * as ts from 'typescript/ast';

export function isExported(node: ts.Node): boolean {
  let declaration = node;
  if (ts.isBindingElement(node) && (!node.name || !ts.isIdentifier(node.name))) return false;
  if (ts.isVariableDeclaration(node) && !ts.isIdentifier(node.name)) return false;
  while (ts.isBindingElement(declaration) || ts.isObjectBindingPattern(declaration) || ts.isArrayBindingPattern(declaration))
    declaration = declaration.parent;
  if (ts.isVariableDeclaration(declaration) && ts.isVariableDeclarationList(declaration.parent)
    && ts.isVariableStatement(declaration.parent.parent)) declaration = declaration.parent.parent;
  return 'modifierFlags' in declaration && Boolean((declaration.modifierFlags as number) & ts.ModifierFlags.Export);
}
