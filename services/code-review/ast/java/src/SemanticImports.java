package eer;

import com.google.gson.*;
import com.sun.source.tree.*;
import com.sun.source.util.*;
import javax.lang.model.element.PackageElement;

final class SemanticImports {
    static JsonArray collect(CompilationUnitTree unit, Iterable<? extends CompilationUnitTree> units, Trees trees) {
        var imports = new JsonArray();
        for (var item : unit.getImports()) {
            var identifier = item.getQualifiedIdentifier();
            if (identifier instanceof MemberSelectTree member && member.getIdentifier().contentEquals("*")) identifier = member.getExpression();
            var element = trees.getElement(TreePath.getPath(unit, identifier));
            var paths = new JsonArray();
            if (element instanceof PackageElement pack) {
                for (var candidate : units) if (candidate.getPackageName() != null && candidate.getPackageName().toString().equals(pack.getQualifiedName().toString()))
                    paths.add(java.nio.file.Path.of(candidate.getSourceFile().toUri()).toString());
            } else if (element != null) {
                var declaration = trees.getPath(element);
                if (declaration != null) paths.add(java.nio.file.Path.of(declaration.getCompilationUnit().getSourceFile().toUri()).toString());
            }
            var value = new JsonObject(); value.addProperty("source", item.getQualifiedIdentifier().toString().replaceAll("\\.\\*$", ""));
            value.addProperty("resolved", element != null && element.asType().getKind() != javax.lang.model.type.TypeKind.ERROR); value.add("paths", paths); imports.add(value);
        }
        return imports;
    }
}
