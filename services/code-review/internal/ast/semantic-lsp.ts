import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { semanticLocationSchema, semanticId, type SemanticResult, type SemanticLocation } from './semantic-schema.js';
import { rangeSchema } from './location.js';
import { parseTree, identifierNodes, sourceLocator } from './tree.js';
import { languageServer } from './lsp-server.js';
import { object, type LspClient } from './lsp-client.js';

function definition(value: unknown): SemanticLocation | null {
  const first = Array.isArray(value) ? value[0] : value;
  const item = object(first);
  const parsed = semanticLocationSchema.safeParse(item['targetUri'] ? { uri: item['targetUri'], range: item['targetSelectionRange'] ?? item['targetRange'] } : first);
  return parsed.success ? parsed.data : null;
}
function hover(value: unknown): string | null {
  const contents = object(value)['contents'];
  const text = typeof contents === 'string' ? contents : Array.isArray(contents)
    ? contents.map((item) => typeof item === 'string' ? item : object(item)['value']).join('\n') : object(contents)['value'];
  if (typeof text !== 'string' || !text.trim()) return null;
  const blocks = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((item) => item[1]!.trim());
  return (blocks.length ? blocks.join('\n') : text).slice(0, 16000);
}
async function ready(client: LspClient, uri: string, language: string) {
  const deadline = Date.now() + 25000;
  while (true) {
    try {
      const symbols = await client.request('textDocument/documentSymbol', { textDocument: { uri } });
      if (language === 'python' || client.quiescent) return;
    } catch (error) { if (![-32801, -32800].includes(Number(object(error)['code'])) && !String(error).includes('file not found')) throw error; }
    if (Date.now() > deadline) throw new Error('Language server workspace did not become ready');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function lspSemantics(language: 'python' | 'rust', path: string, source: string, root: string): Promise<SemanticResult> {
  const { client, version } = await languageServer(language, root, path), uri = pathToFileURL(path).href;
  client.notify('textDocument/didOpen', { textDocument: { uri, languageId: language, version: Date.now(), text: source } });
  await ready(client, uri, language);
  const syntax = await parseTree(language, source), locate = sourceLocator(source);
  const result: SemanticResult = { provider: language === 'python' ? 'pyright' : 'rust-analyzer', version,
    status: 'complete', symbols: [], references: [], diagnostics: [], limitations: language === 'rust' ? ['Build scripts and procedural macro execution disabled; unavailable expansions stay unresolved'] : [] };
  try {
    const nodes = identifierNodes(syntax.tree.rootNode);
    for (let index = 0; index < nodes.length; index += 8) await Promise.all(nodes.slice(index, index + 8).map(async (node) => {
      const range = locate(node.startIndex, node.endIndex), params = { textDocument: { uri }, position: range.start };
      const [rawDefinition, rawType] = await Promise.all([client.request('textDocument/definition', params), client.request('textDocument/hover', params)]);
      const target = definition(rawDefinition), type = hover(rawType);
      const declaration = Boolean(target?.uri === uri && target.range.start.line === range.start.line && target.range.start.character === range.start.character);
      result.references.push({ name: node.text, range, declaration, definition: target, type, targetId: target ? semanticId(target) : null });
      if (declaration && target) result.symbols.push({ id: semanticId(target), name: node.text, kind: 'language-server-symbol', range, definition: target, type });
    }));
    result.diagnostics = (client.diagnostics.get(uri) ?? []).map((value) => {
      const item = object(value), range = rangeSchema.safeParse(item['range']);
      return { message: String(item['message']), severity: item['severity'] === 1 ? 'error' : 'warning', range: range.success ? range.data : null };
    });
    if (result.diagnostics.some((item) => item.severity === 'error')) result.status = 'partial';
    if (nodes.length && !result.references.some((item) => item.type !== null)) {
      result.status = 'partial'; result.limitations.push('Language server has not resolved any requested types in this project context');
    }
    if (result.references.some((item) => item.definition === null && item.type === null)) {
      result.status = 'partial'; result.limitations.push('Unresolved symbol/type occurrences are retained explicitly');
    }
    result.references.sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);
    return result;
  } finally { syntax.dispose(); client.notify('textDocument/didClose', { textDocument: { uri } }); }
}
