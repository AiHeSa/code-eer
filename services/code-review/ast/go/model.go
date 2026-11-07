package main

import (
	"go/ast"
	"go/token"
)

type Input struct {
	Path     string `json:"path"`
	Source   string `json:"source"`
	Root     string `json:"root"`
	Semantic bool   `json:"semantic"`
}
type Node struct {
	ID         string         `json:"id"`
	Parent     *string        `json:"parent"`
	Type       string         `json:"type"`
	NativeType string         `json:"nativeType"`
	Name       *string        `json:"name"`
	Start      *int           `json:"start"`
	End        *int           `json:"end"`
	Parameters []string       `json:"parameters,omitempty"`
	Returns    []string       `json:"returns,omitempty"`
	BodyStart  *int           `json:"bodyStart,omitempty"`
	BodyEnd    *int           `json:"bodyEnd,omitempty"`
	Data       map[string]any `json:"data"`
}
type Diagnostic struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Start   int    `json:"start"`
	End     int    `json:"end"`
}
type Result struct {
	Version           string       `json:"version"`
	Runtime           string       `json:"runtime"`
	Encoding          string       `json:"encoding"`
	Nodes             []Node       `json:"nodes"`
	Diagnostics       []Diagnostic `json:"diagnostics"`
	StructureComplete bool         `json:"structureComplete"`
}
type Extractor struct {
	Files  *token.FileSet
	Source string
	Result *Result
}

func (e *Extractor) text(node ast.Node) string {
	if node == nil {
		return ""
	}
	start, end := e.bounds(node)
	if start == nil {
		return ""
	}
	return e.Source[*start:*end]
}
func (e *Extractor) bounds(node ast.Node) (*int, *int) {
	start, end := e.Files.Position(node.Pos()).Offset, e.Files.Position(node.End()).Offset
	if !node.Pos().IsValid() || !node.End().IsValid() || start > end || end > len(e.Source) {
		return nil, nil
	}
	return &start, &end
}
func (e *Extractor) fields(list *ast.FieldList) []string {
	items := []string{}
	if list == nil {
		return items
	}
	for _, field := range list.List {
		items = append(items, e.text(field))
	}
	return items
}
