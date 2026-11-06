import ast


def text(node):
    return ast.unparse(node) if node is not None else None


def parameter_details(args):
    positional = args.posonlyargs + args.args
    defaults = [None] * (len(positional) - len(args.defaults)) + args.defaults
    entries = [(arg, 'positionalOnly' if index < len(args.posonlyargs) else 'positional', default)
               for index, (arg, default) in enumerate(zip(positional, defaults))]
    if args.vararg:
        entries.append((args.vararg, 'vararg', None))
    entries.extend((arg, 'keywordOnly', default) for arg, default in zip(args.kwonlyargs, args.kw_defaults))
    if args.kwarg:
        entries.append((args.kwarg, 'kwarg', None))
    return [{'name': arg.arg, 'kind': kind, 'annotation': text(arg.annotation),
             'default': text(default), 'typeComment': getattr(arg, 'type_comment', None)}
            for arg, kind, default in entries]


def details(node):
    data = {}
    if hasattr(node, 'type_params'):
        data['typeParameters'] = [ast.unparse(item) for item in node.type_params]
    if hasattr(node, 'decorator_list'):
        data['decorators'] = [ast.unparse(item) for item in node.decorator_list]
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
        data.update({'positionalOnly': [arg.arg for arg in node.args.posonlyargs],
                     'keywordOnly': [arg.arg for arg in node.args.kwonlyargs],
                     'parameterDetails': parameter_details(node.args),
                     'typeComment': getattr(node, 'type_comment', None)})
    if isinstance(node, (ast.Import, ast.ImportFrom)):
        data.update({'names': [{'name': item.name, 'alias': item.asname} for item in node.names],
                     'level': getattr(node, 'level', 0)})
    if isinstance(node, ast.ClassDef):
        data.update({'bases': [ast.unparse(item) for item in node.bases],
                     'keywords': [ast.unparse(item) for item in node.keywords]})
    return data
