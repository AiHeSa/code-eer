package eer;

import com.google.gson.*;
import com.sun.source.util.*;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.*;
import javax.tools.*;

public final class SemanticMain {
    static JsonObject analyze(JsonObject input) throws Exception {
        var compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) throw new IllegalStateException("JDK compiler is unavailable");
        var diagnostics = new DiagnosticCollector<JavaFileObject>();
        try (var manager = compiler.getStandardFileManager(diagnostics, null, StandardCharsets.UTF_8)) {
            var options = List.of("-proc:none", "-implicit:none", "-classpath", System.getProperty("java.class.path"),
                "-sourcepath", input.get("root").getAsString());
            var task = (JavacTask)compiler.getTask(null, manager, diagnostics, options, null, SemanticSource.sources(input));
            var units = task.parse(); task.analyze();
            var imports = new JsonArray();
            var scanner = new SemanticScan(Trees.instance(task));
            var target = Path.of(input.get("path").getAsString()).toRealPath();
            for (var unit : units) if (Path.of(unit.getSourceFile().toUri()).toRealPath().equals(target)) {
                scanner.scan(unit, null); imports = SemanticImports.collect(unit, units, Trees.instance(task));
            }
            var problems = new JsonArray();
            for (var problem : diagnostics.getDiagnostics()) {
                var item = new JsonObject(); item.addProperty("message", problem.getMessage(Locale.ROOT));
                item.addProperty("severity", problem.getKind() == Diagnostic.Kind.ERROR ? "error" : "warning"); problems.add(item);
            }
            var result = new JsonObject(); result.addProperty("provider", "javac/Trees");
            result.addProperty("version", System.getProperty("java.version")); result.addProperty("encoding", "utf16");
            result.addProperty("status", diagnostics.getDiagnostics().stream().anyMatch(p -> p.getKind() == Diagnostic.Kind.ERROR) ? "partial" : "complete");
            result.add("references", scanner.references); result.add("diagnostics", problems); result.add("imports", imports);
            var limits = new JsonArray(); limits.add("Annotation processing disabled; unresolved classpath and unsupported language level retain compiler diagnostics");
            result.add("limitations", limits); return result;
        }
    }
    public static void main(String[] args) throws Exception {
        var input = JsonParser.parseReader(new InputStreamReader(System.in, StandardCharsets.UTF_8)).getAsJsonObject();
        System.out.println(new GsonBuilder().serializeNulls().create().toJson(analyze(input)));
    }
}
