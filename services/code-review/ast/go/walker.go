package main

import "go/ast"

type Walker struct {
    Extractor   *Extractor
    Parent      *string
    InInterface bool
}

func (walker Walker) Visit(node ast.Node) ast.Visitor {
    if node == nil {
        return nil
    }
    next := walker
    if item := walker.Extractor.declaration(node, walker.Parent, walker.InInterface); item != nil {
        id := item.ID
        next.Parent = &id
    }
    _, isInterface := node.(*ast.InterfaceType)
    _, isFields := node.(*ast.FieldList)
    next.InInterface = isInterface || isFields && walker.InInterface
    return next
}
