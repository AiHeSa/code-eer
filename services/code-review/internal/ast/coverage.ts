import type { Language } from './schema.js';
import type { Coverage, Syntax } from './coverage-schema.js';

const profiles: Record<Language, Omit<Coverage, 'projection'>> = {
    'js-ts': {
        nativeNodes: [
            'FunctionDeclaration',
            'FunctionExpression',
            'ArrowFunction',
            'VariableDeclaration',
            'BindingElement',
            'MethodDeclaration',
            'MethodSignature',
            'GetAccessor',
            'SetAccessor',
            'Constructor',
            'CallSignature',
            'ConstructSignature',
            'ClassDeclaration',
            'ClassExpression',
            'InterfaceDeclaration',
            'TypeAliasDeclaration',
            'EnumDeclaration',
            'ModuleDeclaration',
            'ImportDeclaration',
            'ImportEqualsDeclaration',
            'ExportDeclaration',
            'ExportAssignment',
            'JsxElement',
            'JsxSelfClosingElement',
            'JsxFragment',
            'JsxAttribute',
            'JsxSpreadAttribute',
            'JsxExpression',
            'CallExpression(require)',
            'BinaryExpression(CommonJS export)',
        ],
        metadata: [
            'modifiers',
            'typeParameters',
            'heritage',
            'declaration',
            'clause',
            'declarationId',
            'moduleSystem',
            'source',
            'dynamic',
            'value',
            'spread',
        ],
        limitations: [
            'Expressions and statements are retained through source ranges',
            'CommonJS names require direct globals and static property keys',
            'Symbol and type queries require the semantic feature',
            'Dynamic eval and with scopes are unresolved',
            'Compiler target configures compilation and does not constrain accepted syntax',
        ],
    },
    python: {
        nativeNodes: ['FunctionDef', 'AsyncFunctionDef', 'Lambda', 'ClassDef', 'TypeAlias', 'Import', 'ImportFrom'],
        metadata: [
            'positionalOnly',
            'keywordOnly',
            'parameterDetails',
            'decorators',
            'bases',
            'keywords',
            'typeParameters',
            'typeComment',
            'names',
            'level',
        ],
        limitations: [
            'Assignments, fields, expressions and statements have no independent facts',
            'Fine scopes require assessment collection; symbols and types require Pyright semantics',
        ],
    },
    java: {
        nativeNodes: [
            'MethodDeclaration',
            'ConstructorDeclaration',
            'CompactConstructorDeclaration',
            'AnnotationMemberDeclaration',
            'LambdaExpr',
            'ClassOrInterfaceDeclaration',
            'EnumDeclaration',
            'RecordDeclaration',
            'AnnotationDeclaration',
            'ObjectCreationExpr(anonymous class)',
            'EnumConstantDeclaration(class body)',
            'ImportDeclaration',
            'PackageDeclaration',
            'ModuleDeclaration',
            'ModuleRequiresDirective',
            'ModuleUsesDirective',
            'ModuleExportsDirective',
            'ModuleOpensDirective',
            'ModuleProvidesDirective',
        ],
        metadata: [
            'modifiers',
            'annotations',
            'typeParameters',
            'throws',
            'extends',
            'implements',
            'permits',
            'components',
            'static',
            'wildcard',
            'directive',
            'declaration',
        ],
        limitations: [
            'Fields and initializer blocks have no independent structural facts',
            'Classpath types require javac semantics and available dependencies',
        ],
    },
    go: {
        nativeNodes: [
            '*ast.Ident(package)',
            '*ast.FuncDecl',
            '*ast.FuncLit',
            '*ast.TypeSpec',
            '*ast.ImportSpec',
            '*ast.Field(interface method)',
        ],
        metadata: ['receiver', 'typeParameters', 'declaration', 'typeAlias', 'alias', 'positionUnavailable'],
        limitations: [
            'ValueSpec and fields have no independent structural facts',
            'Active-build package and type queries require go/types semantics',
        ],
    },
    rust: {
        nativeNodes: [
            'ItemFn',
            'ImplItemFn',
            'TraitItemFn',
            'ItemImpl',
            'ItemTrait',
            'ItemStruct',
            'ItemEnum',
            'ItemType',
            'TraitItemType',
            'ImplItemType',
            'ItemUse',
            'ItemExternCrate',
            'ItemMod',
            'ItemUnion',
            'ExprClosure',
            'ItemForeignMod',
            'ForeignItemFn',
        ],
        metadata: ['generics', 'attributes', 'visibility', 'alias', 'container', 'declaration'],
        limitations: [
            'Constants, statics, fields and variants have no independent facts',
            'Cargo symbols and types require rust-analyzer semantics; build scripts and procedural macros are disabled',
            'Structural parser does not enforce edition constraints',
        ],
    },
};

export function coverageFor(language: Language, framework?: 'react' | 'vue' | null): Coverage {
    const base = structuredClone(profiles[language]);
    if (framework === 'react') {
        base.nativeNodes.push('React component candidates', 'CallExpression(Hook candidate)');
        base.metadata.push('evidence', 'certainty', 'bindingResolution', 'usage', 'imported', 'arguments');
        base.limitations.push(
            'React components and Hooks are syntax candidates; cross-file targets and prop types are unresolved',
        );
    }
    if (framework === 'vue') {
        base.nativeNodes.push(
            'SFCDescriptor',
            'SFCBlock',
            'ExternalSFCBlock',
            'ElementNode',
            'AttributeNode',
            'DirectiveNode',
            'SimpleExpressionNode',
            'InterpolationNode',
            'CallExpression',
            'PropertyAssignment',
            'ShorthandPropertyAssignment',
            'MethodDeclaration',
            'GetAccessor',
        );
        base.metadata.push(
            'owner',
            'language',
            'src',
            'attributes',
            'framework',
            'evidence',
            'tagType',
            'expression',
            'argument',
            'directive',
            'usage',
            'bindingResolution',
        );
        base.limitations.push(
            'Template and slot binding targets and component prop types are unresolved',
            'Style and custom blocks expose attributes and ranges; preprocessor support is declared per block',
        );
    }
    return { projection: 'selected-facts', ...base };
}

export function syntaxFor(
    language: Language,
    parserVersion: string,
    config: {
        pythonVersion?: number | undefined;
        javaLanguageLevel?: string | undefined;
        rustEdition?: string | undefined;
    } = {},
): Syntax {
    const profiles: Record<Language, Omit<Syntax, 'parserVersion'>> = {
        'js-ts': {
            grammar: 'TypeScript/JavaScript/JSX',
            targetVersion: null,
            versionConstraint: 'not-enforced',
            configurationKeys: ['tsconfig'],
        },
        python: {
            grammar: 'Python',
            targetVersion: config.pythonVersion ? `3.${config.pythonVersion}` : parserVersion,
            versionConstraint: config.pythonVersion ? 'best-effort' : 'parser',
            configurationKeys: ['pythonVersion'],
        },
        java: {
            grammar: 'Java',
            targetVersion: config.javaLanguageLevel ?? 'BLEEDING_EDGE',
            versionConstraint: 'parser',
            configurationKeys: ['javaLanguageLevel'],
        },
        go: { grammar: 'Go', targetVersion: parserVersion, versionConstraint: 'parser', configurationKeys: [] },
        rust: {
            grammar: 'Rust',
            targetVersion: config.rustEdition ?? null,
            versionConstraint: 'not-enforced',
            configurationKeys: ['rustEdition'],
        },
    };
    return { ...profiles[language], parserVersion };
}
