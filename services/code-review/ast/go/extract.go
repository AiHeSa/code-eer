package main

import (
	"fmt"
	"go/ast"
	"reflect"
)

func (e *Extractor) append(node ast.Node, kind, name string, parent *string) *Node {
	start, end := e.bounds(node)
	var label *string
	if name != "" {
		label = &name
	}
	item := Node{ID: fmt.Sprint(len(e.Result.Nodes)), Parent: parent, Type: kind,
		NativeType: reflect.TypeOf(node).String(), Name: label, Data: map[string]any{}, Start: start, End: end}
	if start == nil {
		item.Data["positionUnavailable"] = "Incomplete syntax range"
	}
	e.Result.Nodes = append(e.Result.Nodes, item)
	return &e.Result.Nodes[len(e.Result.Nodes)-1]
}

func (e *Extractor) signature(item *Node, signature *ast.FuncType, body *ast.BlockStmt) {
	item.Parameters, item.Returns = e.fields(signature.Params), e.fields(signature.Results)
	item.Data["typeParameters"] = e.fields(signature.TypeParams)
	if body != nil {
		item.BodyStart, item.BodyEnd = e.bounds(body)
	}
}

func (e *Extractor) declaration(node ast.Node, parent *string, inInterface bool) *Node {
	switch value := node.(type) {
	case *ast.FuncDecl:
		kind := "function"
		if value.Recv != nil {
			kind = "method"
		}
		item := e.append(value, kind, value.Name.Name, parent)
		e.signature(item, value.Type, value.Body)
		item.Data["receiver"] = e.fields(value.Recv)
		return item
	case *ast.FuncLit:
		item := e.append(value, "function", "", parent)
		e.signature(item, value.Type, value.Body)
		return item
	case *ast.TypeSpec:
		item := e.append(value, "type", value.Name.Name, parent)
		item.Data["declaration"] = e.text(value.Type)
		item.Data["typeAlias"] = value.Assign.IsValid()
		item.Data["typeParameters"] = e.fields(value.TypeParams)
		return item
	case *ast.ImportSpec:
		item := e.append(value, "import", value.Path.Value, parent)
		if value.Name != nil {
			item.Data["alias"] = value.Name.Name
		}
		return item
	case *ast.Field:
		if signature, ok := value.Type.(*ast.FuncType); inInterface && ok && len(value.Names) > 0 {
			item := e.append(value, "method", value.Names[0].Name, parent)
			e.signature(item, signature, nil)
			return item
		}
	}
	return nil
}
