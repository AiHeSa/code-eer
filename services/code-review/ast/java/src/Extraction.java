package eer;

import com.github.javaparser.ast.ImportDeclaration;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.PackageDeclaration;
import com.github.javaparser.ast.body.*;
import com.github.javaparser.ast.expr.LambdaExpr;
import com.github.javaparser.ast.expr.ObjectCreationExpr;
import com.github.javaparser.ast.modules.*;
import com.google.gson.*;

final class Extraction {

    final JsonArray nodes = new JsonArray();
    private final Source source;

    Extraction(Source source) {
        this.source = source;
    }

    String kind(Node node) {
        if (node instanceof MethodDeclaration || node instanceof AnnotationMemberDeclaration) return "method";
        if (
            node instanceof ConstructorDeclaration || node instanceof CompactConstructorDeclaration
        ) return "constructor";
        if (node instanceof LambdaExpr) return "function";
        if (node instanceof TypeDeclaration<?>) return "type";
        if (node instanceof ObjectCreationExpr value && value.getAnonymousClassBody().isPresent()) return "type";
        if (node instanceof EnumConstantDeclaration value && !value.getClassBody().isEmpty()) return "type";
        if (node instanceof ModuleDeclaration) return "module";
        if (node instanceof ModuleRequiresDirective || node instanceof ModuleUsesDirective) return "import";
        if (
            node instanceof ModuleExportsDirective ||
            node instanceof ModuleOpensDirective ||
            node instanceof ModuleProvidesDirective
        ) return "export";
        if (node instanceof ImportDeclaration) return "import";
        if (node instanceof PackageDeclaration) return "module";
        return null;
    }

    String name(Node node) {
        if (node instanceof CallableDeclaration<?> value) return value.getNameAsString();
        if (node instanceof CompactConstructorDeclaration value) return value.getNameAsString();
        if (node instanceof AnnotationMemberDeclaration value) return value.getNameAsString();
        if (node instanceof TypeDeclaration<?> value) return value.getNameAsString();
        if (node instanceof ImportDeclaration value) return value.getNameAsString();
        if (node instanceof PackageDeclaration value) return value.getNameAsString();
        if (node instanceof EnumConstantDeclaration value) return value.getNameAsString();
        if (node instanceof com.github.javaparser.ast.nodeTypes.NodeWithName<?> value) return value.getNameAsString();
        return null;
    }

    void walk(Node node, String parent) {
        String kind = kind(node);
        String next = parent;
        if (kind != null) {
            var output = new JsonObject();
            next = Integer.toString(nodes.size());
            output.addProperty("id", next);
            output.addProperty("parent", parent);
            output.addProperty("type", kind);
            output.addProperty("nativeType", node.getClass().getSimpleName());
            output.addProperty("name", name(node));
            output.add("start", source.position(node, false));
            output.add("end", source.position(node, true));
            output.add("data", details(node));
            callable(node, output);
            nodes.add(output);
        }
        for (Node child : node.getChildNodes()) walk(child, next);
    }

    JsonObject details(Node node) {
        var data = new JsonObject();
        if (node instanceof com.github.javaparser.ast.nodeTypes.NodeWithModifiers<?> value) data.add(
            "modifiers",
            Source.strings(value.getModifiers())
        );
        if (node instanceof com.github.javaparser.ast.nodeTypes.NodeWithAnnotations<?> value) data.add(
            "annotations",
            Source.strings(value.getAnnotations())
        );
        if (node instanceof com.github.javaparser.ast.nodeTypes.NodeWithTypeParameters<?> value) data.add(
            "typeParameters",
            Source.strings(value.getTypeParameters())
        );
        if (node instanceof com.github.javaparser.ast.nodeTypes.NodeWithThrownExceptions<?> value) data.add(
            "throws",
            Source.strings(value.getThrownExceptions())
        );
        if (node instanceof com.github.javaparser.ast.nodeTypes.NodeWithExtends<?> value) data.add(
            "extends",
            Source.strings(value.getExtendedTypes())
        );
        if (node instanceof com.github.javaparser.ast.nodeTypes.NodeWithImplements<?> value) data.add(
            "implements",
            Source.strings(value.getImplementedTypes())
        );
        if (node instanceof ClassOrInterfaceDeclaration value) data.add(
            "permits",
            Source.strings(value.getPermittedTypes())
        );
        if (node instanceof RecordDeclaration value) data.add("components", Source.strings(value.getParameters()));
        if (node instanceof ImportDeclaration value) {
            data.addProperty("static", value.isStatic());
            data.addProperty("wildcard", value.isAsterisk());
        }
        if (node instanceof ModuleDirective) {
            data.addProperty("directive", node.getClass().getSimpleName());
            data.addProperty("declaration", node.toString());
        }
        return data;
    }

    void callable(Node node, JsonObject output) {
        Node body = null;
        if (node instanceof CallableDeclaration<?> value) output.add(
            "parameters",
            Source.strings(value.getParameters())
        );
        if (node instanceof MethodDeclaration value) {
            output.add("returns", Source.strings(java.util.List.of(value.getType())));
            body = value.getBody().orElse(null);
        }
        if (node instanceof ConstructorDeclaration value) body = value.getBody();
        if (node instanceof CompactConstructorDeclaration value) body = value.getBody();
        if (node instanceof AnnotationMemberDeclaration value) output.add(
            "returns",
            Source.strings(java.util.List.of(value.getType()))
        );
        if (node instanceof LambdaExpr value) {
            output.add("parameters", Source.strings(value.getParameters()));
            body = value.getBody();
        }
        if (body != null) {
            output.add("bodyStart", source.position(body, false));
            output.add("bodyEnd", source.position(body, true));
        }
    }
}
