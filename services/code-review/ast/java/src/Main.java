package eer;

import com.github.javaparser.JavaParser;
import com.github.javaparser.ParserConfiguration;
import com.google.gson.*;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public final class Main {

    static JsonObject parse(JsonObject input) {
        String text = input.get("source").getAsString();
        var source = new Source(text);
        var configuration = new ParserConfiguration();
        configuration.setLanguageLevel(ParserConfiguration.LanguageLevel.BLEEDING_EDGE);
        configuration.setTabSize(1);
        configuration.setPreprocessUnicodeEscapes(true);
        if (
            input.has("config") && input.getAsJsonObject("config").has("javaLanguageLevel")
        ) configuration.setLanguageLevel(
            ParserConfiguration.LanguageLevel.valueOf(
                input.getAsJsonObject("config").get("javaLanguageLevel").getAsString()
            )
        );
        var parsed = new JavaParser(configuration).parse(text);
        var extraction = new Extraction(source);
        parsed.getResult().ifPresent(node -> extraction.walk(node, null));
        var diagnostics = new JsonArray();
        parsed.getProblems().forEach(problem -> diagnostics.add(source.diagnostic(problem)));
        var output = new JsonObject();
        output.addProperty("version", "3.28.2");
        output.addProperty("runtime", System.getProperty("java.version"));
        output.addProperty("encoding", "utf16");
        output.addProperty("structureComplete", parsed.isSuccessful());
        output.add("nodes", extraction.nodes);
        output.add("diagnostics", diagnostics);
        return output;
    }

    public static void main(String[] args) {
        var input = JsonParser.parseReader(new InputStreamReader(System.in, StandardCharsets.UTF_8)).getAsJsonObject();
        System.out.println(new GsonBuilder().serializeNulls().create().toJson(parse(input)));
    }
}
