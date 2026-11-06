package main

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/scanner"
	"go/token"
	"os"
	"runtime"
)

func diagnostics(err error, result *Result) {
	if list, ok := err.(scanner.ErrorList); ok {
		for _, item := range list {
			result.Diagnostics = append(result.Diagnostics, Diagnostic{
				Code: "SYNTAX_ERROR", Message: item.Msg, Start: item.Pos.Offset, End: item.Pos.Offset})
		}
	}
}
func parse(input Input) Result {
	result := Result{Version: runtime.Version(), Runtime: runtime.Version(), Encoding: "utf8",
		Nodes: []Node{}, Diagnostics: []Diagnostic{}}
	files := token.NewFileSet()
	file, err := parser.ParseFile(files, input.Path, input.Source, parser.AllErrors|parser.ParseComments)
	result.StructureComplete = err == nil
	diagnostics(err, &result)
	if file == nil {
		return result
	}
	extractor := Extractor{Files: files, Source: input.Source, Result: &result}
	if file.Name != nil {
		extractor.append(file.Name, "module", file.Name.Name, nil)
	}
	ast.Walk(Walker{Extractor: &extractor}, file)
	return result
}
func main() {
	var input Input
	if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
		panic(err)
	}
	if err := json.NewEncoder(os.Stdout).Encode(parse(input)); err != nil {
		panic(err)
	}
}
