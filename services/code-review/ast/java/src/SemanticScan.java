package eer;

import com.google.gson.*;
import com.sun.source.tree.*;
import com.sun.source.util.*;
import javax.lang.model.element.Element;

final class SemanticScan extends TreePathScanner<Void, Void> {

    final Trees trees;
    final JsonArray references = new JsonArray();

    SemanticScan(Trees trees) {
        this.trees = trees;
    }

    JsonObject location(TreePath path) {
        var unit = path.getCompilationUnit();
        var positions = trees.getSourcePositions();
        return SemanticSource.location(
            java.nio.file.Path.of(unit.getSourceFile().toUri()).toString(),
            positions.getStartPosition(unit, path.getLeaf()),
            positions.getEndPosition(unit, path.getLeaf())
        );
    }

    void reference(String name, boolean declaration) {
        var path = getCurrentPath();
        var element = trees.getElement(path);
        var span = location(path);
        if (span == null || name.isEmpty() || name.equals("<init>")) return;
        var item = new JsonObject();
        item.addProperty("name", name);
        item.addProperty("declaration", declaration);
        item.add("path", span.get("path"));
        item.add("start", span.get("start"));
        item.add("end", span.get("end"));
        var type = trees.getTypeMirror(path);
        item.addProperty(
            "type",
            type == null || type.getKind() == javax.lang.model.type.TypeKind.ERROR ? null : type.toString()
        );
        var definition = element == null ? null : trees.getPath(element);
        item.add("definition", definition == null ? JsonNull.INSTANCE : location(definition));
        item.addProperty(
            "targetId",
            element == null
                ? null
                : "java:" + element.getEnclosingElement() + ":" + element.getSimpleName() + ":" + element.asType()
        );
        references.add(item);
    }

    @Override
    public Void visitIdentifier(IdentifierTree node, Void unused) {
        reference(node.getName().toString(), false);
        return super.visitIdentifier(node, unused);
    }

    @Override
    public Void visitMemberSelect(MemberSelectTree node, Void unused) {
        reference(node.getIdentifier().toString(), false);
        return super.visitMemberSelect(node, unused);
    }

    @Override
    public Void visitVariable(VariableTree node, Void unused) {
        reference(node.getName().toString(), true);
        return super.visitVariable(node, unused);
    }

    @Override
    public Void visitMethod(MethodTree node, Void unused) {
        reference(node.getName().toString(), true);
        return super.visitMethod(node, unused);
    }

    @Override
    public Void visitClass(ClassTree node, Void unused) {
        reference(node.getSimpleName().toString(), true);
        return super.visitClass(node, unused);
    }
}
