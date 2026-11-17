package dev.skywake;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.function.Function;

final class Pages<T> implements Iterable<T> {
    private final Function<String, JsonNode> load;
    private final Function<JsonNode, T> convert;

    Pages(Function<String, JsonNode> load, Function<JsonNode, T> convert) {
        this.load = load;
        this.convert = convert;
    }

    static <T> Pages<T> of(Http http, String path, Body query, Class<T> type) {
        return of(http, path, query, node -> Json.as(node, type));
    }

    static <T> Pages<T> of(Http http, String path, Body query, Function<JsonNode, T> convert) {
        return new Pages<>(cursor -> http.get(path, new Body().with(query).with("cursor", cursor)), convert);
    }

    static <T> List<T> all(Iterable<T> items) {
        List<T> found = new ArrayList<>();
        items.forEach(found::add);
        return found;
    }

    List<T> all() {
        return all(this);
    }

    @Override
    public Iterator<T> iterator() {
        return new Iterator<>() {
            private Iterator<JsonNode> page = null;
            private String cursor = null;
            private boolean last = false;

            @Override
            public boolean hasNext() {
                while ((page == null || !page.hasNext()) && !last) {
                    JsonNode loaded = load.apply(cursor);
                    page = loaded.path("data").iterator();
                    JsonNode next = loaded.path("next");
                    cursor = next.isTextual() && !next.asText().isEmpty() ? next.asText() : null;
                    last = cursor == null;
                }
                return page.hasNext();
            }

            @Override
            public T next() {
                if (!hasNext()) {
                    throw new NoSuchElementException();
                }
                return convert.apply(page.next());
            }
        };
    }
}
