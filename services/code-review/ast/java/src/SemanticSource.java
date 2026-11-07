package eer;

import com.google.gson.*;
import java.io.IOException;
import java.net.URI;
import java.nio.file.*;
import javax.tools.SimpleJavaFileObject;

final class SemanticSource extends SimpleJavaFileObject {

    final String source;

    SemanticSource(Path path, String source) {
        super(path.toUri(), Kind.SOURCE);
        this.source = source;
    }

    @Override
    public CharSequence getCharContent(boolean ignoreErrors) {
        return source;
    }

    static JsonObject location(String path, long start, long end) {
        if (start < 0 || end < start) return null;
        var value = new JsonObject();
        value.addProperty("path", path);
        value.addProperty("start", start);
        value.addProperty("end", end);
        return value;
    }

    static java.util.List<SemanticSource> sources(JsonObject input) throws IOException {
        var root = Path.of(input.get("root").getAsString()).toRealPath();
        var target = Path.of(input.get("path").getAsString()).toRealPath();
        var result = new java.util.ArrayList<SemanticSource>();
        try (var files = Files.walk(root)) {
            for (var path : files
                .filter(Files::isRegularFile)
                .filter(p -> p.toString().endsWith(".java"))
                .toList()) {
                if (
                    root
                        .relativize(path)
                        .toString()
                        .matches(".*(?:^|/)(?:\\.cache|node_modules|target|build|\\.git)/.*")
                ) continue;
                if (!path.toRealPath().startsWith(root)) continue;
                result.add(
                    new SemanticSource(
                        path,
                        path.toRealPath().equals(target) ? input.get("source").getAsString() : Files.readString(path)
                    )
                );
                if (result.size() > 10000) throw new IOException("Java project exceeds 10000 source files");
            }
        }
        return result;
    }
}
