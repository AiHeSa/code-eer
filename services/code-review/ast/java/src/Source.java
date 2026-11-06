package eer;

import com.github.javaparser.Position;
import com.github.javaparser.ast.Node;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;

final class Source {
    private final String text;
    private final java.util.List<Integer> lines = new java.util.ArrayList<>();

    Source(String text) {
        this.text = text;
        lines.add(0);
        var matcher = java.util.regex.Pattern.compile("\\r\\n|\\r|\\n").matcher(text);
        while (matcher.find()) lines.add(matcher.end());
    }

    int offset(Position position, boolean end) {
        if (position.line > lines.size()) return text.length();
        int index = lines.get(position.line - 1);
        return Math.min(text.length(), index + position.column - (end ? 0 : 1));
    }

    JsonElement position(Node node, boolean end) {
        if (node.getRange().isEmpty()) return JsonNull.INSTANCE;
        var range = node.getRange().get();
        return new com.google.gson.JsonPrimitive(offset(end ? range.end : range.begin, end));
    }

    static JsonArray strings(Iterable<?> values) {
        var array = new JsonArray();
        for (Object value : values) array.add(value.toString());
        return array;
    }

    JsonObject diagnostic(com.github.javaparser.Problem problem) {
        var output = new JsonObject();
        output.addProperty("code", "SYNTAX_ERROR");
        output.addProperty("message", problem.getMessage());
        JsonElement position = problem.getLocation().flatMap(range -> range.getBegin().getRange())
            .map(range -> (JsonElement) new com.google.gson.JsonPrimitive(offset(range.begin, false)))
            .orElse(JsonNull.INSTANCE);
        output.add("start", position); output.add("end", position);
        return output;
    }
}
