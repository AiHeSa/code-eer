import ast
import json
import re
import sys
from metadata import details


def byte_offset(lines, row, column):
    """Python AST 的列号已经是 UTF-8 字节偏移，不再次按字符转换。"""
    return sum(len(line.encode('utf-8')) for line in lines[: row - 1]) + column


def location(node, lines):
    if not hasattr(node, 'lineno'):
        return None, None
    start = byte_offset(lines, node.lineno, node.col_offset)
    end = byte_offset(lines, node.end_lineno, node.end_col_offset)
    return start, end


def parameters(node):
    args = node.args
    result = [arg.arg for arg in args.posonlyargs + args.args]
    if args.vararg:
        result.append('*' + args.vararg.arg)
    result.extend(arg.arg for arg in args.kwonlyargs)
    if args.kwarg:
        result.append('**' + args.kwarg.arg)
    return result


def describe(node, parent_kind):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        return ('method' if parent_kind == 'type' else 'function'), node.name
    if isinstance(node, ast.Lambda):
        return 'function', None
    if isinstance(node, ast.ClassDef):
        return 'type', node.name
    if hasattr(ast, 'TypeAlias') and isinstance(node, ast.TypeAlias):
        return 'type', node.name.id
    if isinstance(node, (ast.Import, ast.ImportFrom)):
        return 'import', getattr(node, 'module', None) or ','.join(alias.name for alias in node.names)
    return None


def append_node(node, parent, kind, name, output, lines):
    start, end = location(node, lines)
    item = {
        'id': str(len(output)),
        'parent': parent,
        'type': kind,
        'nativeType': type(node).__name__,
        'name': name,
        'start': start,
        'end': end,
        'data': details(node),
    }
    if kind in ('function', 'method'):
        item['parameters'] = parameters(node)
        item['async'] = isinstance(node, ast.AsyncFunctionDef)
        item['returns'] = [ast.unparse(node.returns)] if getattr(node, 'returns', None) else []
        body = node.body
        first, last = (body[0], body[-1]) if isinstance(body, list) else (body, body)
        item['bodyStart'] = location(first, lines)[0]
        item['bodyEnd'] = location(last, lines)[1]
    output.append(item)
    return item['id']


def walk(node, parent, parent_kind, output, lines):
    info = describe(node, parent_kind)
    if info:
        kind, name = info
        parent = append_node(node, parent, kind, name, output, lines)
        parent_kind = kind
    for child in ast.iter_child_nodes(node):
        walk(child, parent, parent_kind, output, lines)


def syntax_diagnostic(error, lines):
    row = error.lineno or 1
    column = max(0, (error.offset or 1) - 1)
    line = lines[row - 1] if row <= len(lines) else ''
    start = byte_offset(lines, row, len(line[:column].encode('utf-8')))
    return {'code': type(error).__name__, 'message': error.msg, 'start': start, 'end': start}


def main():
    request = json.load(sys.stdin)
    source = request['source']
    lines = re.split(r'(?<=\n)|(?<=\r)(?!\n)', source)
    result = {
        'version': sys.version.split()[0],
        'runtime': sys.version.split()[0],
        'encoding': 'utf8',
        'nodes': [],
        'diagnostics': [],
    }
    try:
        version = request.get('config', {}).get('pythonVersion')
        tree = ast.parse(source, filename=request['path'], type_comments=True, feature_version=version)
        walk(tree, None, None, result['nodes'], lines)
    except SyntaxError as error:
        result['diagnostics'].append(syntax_diagnostic(error, lines))
        result['structureComplete'] = False
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
