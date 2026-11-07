package main

import (
    "go/ast"
    "go/token"
    "go/types"
    "golang.org/x/tools/go/packages"
    "os"
    "path/filepath"
    "runtime"
    "sort"
    "strings"
)

func semanticEnvironment(input Input) []string {
    env := []string{}
    for _, item := range os.Environ() {
        name := strings.SplitN(item, "=", 2)[0]
        if name != "GOFLAGS" && name != "GOTOOLCHAIN" && name != "GOPROXY" && name != "CGO_ENABLED" && name != "PATH" {
            env = append(env, item)
        }
    }
    env = append(env, "GOFLAGS=", "GOTOOLCHAIN=local", "GOPROXY=off", "CGO_ENABLED=0", "PATH="+filepath.Join(runtime.GOROOT(), "bin")+string(os.PathListSeparator)+os.Getenv("PATH"))
    directory := filepath.Dir(input.Path)
    for {
        if _, err := os.Stat(filepath.Join(directory, "go.mod")); err == nil {
            return env
        }
        parent := filepath.Dir(directory)
        if parent == directory {
            break
        }
        directory = parent
    }
    return append(env, "GO111MODULE=off")
}

func semanticReference(files *token.FileSet, ident *ast.Ident, object types.Object, declaration bool) SemanticReference {
    start := files.Position(ident.Pos())
    ref := SemanticReference{Name: ident.Name, Path: start.Filename, Start: start.Offset, End: start.Offset + len(ident.Name), Declaration: declaration}
    if object == nil {
        return ref
    }
    typeName := types.TypeString(object.Type(), nil)
    ref.Type = &typeName
    location := files.Position(object.Pos())
    if location.IsValid() {
        ref.Definition = &SemanticLocation{Path: location.Filename, Start: location.Offset, End: location.Offset + len(object.Name())}
    }
    if object.Pkg() != nil {
        ref.TargetID = object.Pkg().Path() + "#" + object.Name()
    } else {
        ref.TargetID = "go:builtin#" + object.Name()
    }
    return ref
}

func analyzeSemantic(input Input) SemanticResult {
    os.Setenv("PATH", filepath.Join(runtime.GOROOT(), "bin")+string(os.PathListSeparator)+os.Getenv("PATH"))
    result := SemanticResult{Provider: "go/packages+go/types", Version: runtime.Version(), Encoding: "utf8", Status: "complete", References: []SemanticReference{}, Imports: []SemanticImport{}, Diagnostics: []SemanticDiagnostic{}, Limitations: []string{"Only active build configuration; cgo disabled; missing dependencies retain compiler diagnostics"}}
    config := &packages.Config{Dir: filepath.Dir(input.Path), Tests: true, Env: semanticEnvironment(input), Overlay: map[string][]byte{input.Path: []byte(input.Source)}, Mode: packages.NeedName | packages.NeedFiles | packages.NeedCompiledGoFiles | packages.NeedSyntax | packages.NeedTypes | packages.NeedTypesInfo | packages.NeedImports | packages.NeedDeps}
    loaded, err := packages.Load(config, ".")
    if err != nil {
        result.Status = "failed"
        result.Diagnostics = append(result.Diagnostics, SemanticDiagnostic{err.Error(), "error"})
        return result
    }
    selected := semanticPackage(loaded, input.Path)
    if selected == nil {
        result.Status = "partial"
        result.Diagnostics = append(result.Diagnostics, SemanticDiagnostic{"File excluded by active build configuration or package loading failed", "error"})
        return result
    }
    semanticFacts(&result, selected, input.Path)
    sort.Slice(result.References, func(i, j int) bool { return result.References[i].Start < result.References[j].Start })
    return result
}

func semanticPackage(loaded []*packages.Package, path string) *packages.Package {
    var selected *packages.Package
    for _, pkg := range loaded {
        for _, file := range pkg.CompiledGoFiles {
            if file == path && (selected == nil || len(pkg.CompiledGoFiles) > len(selected.CompiledGoFiles)) {
                selected = pkg
            }
        }
    }
    return selected
}

func semanticFacts(result *SemanticResult, pkg *packages.Package, path string) {
    for name, imported := range pkg.Imports {
        result.Imports = append(result.Imports, SemanticImport{Source: name, Name: imported.Name, Resolved: imported.Types != nil && imported.Types.Complete() && len(imported.Errors) == 0, Paths: imported.CompiledGoFiles})
    }
    for _, problem := range pkg.Errors {
        result.Status = "partial"
        result.Diagnostics = append(result.Diagnostics, SemanticDiagnostic{problem.Error(), "error"})
    }
    if pkg.TypesInfo == nil {
        return
    }
    for ident, object := range pkg.TypesInfo.Defs {
        if pkg.Fset.Position(ident.Pos()).Filename == path {
            result.References = append(result.References, semanticReference(pkg.Fset, ident, object, true))
        }
    }
    for ident, object := range pkg.TypesInfo.Uses {
        if pkg.Fset.Position(ident.Pos()).Filename == path {
            result.References = append(result.References, semanticReference(pkg.Fset, ident, object, false))
        }
    }
}
