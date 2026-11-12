package dev.skywake;

import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Spliterator;
import java.util.Spliterators;
import java.util.function.Function;
import java.util.stream.Stream;
import java.util.stream.StreamSupport;

/** Reads lists a page at a time. */
final class Paging {
    /** The most items a page of a list holds. */
    static final int PAGE = 1000;

    private Paging() {}

    /** The query of one page: at most {@code limit} items (0 leaves it to the server), from {@code key}. */
    static Map<String, Object> query(int limit, String name, String key) {
        Map<String, Object> query = new LinkedHashMap<>();
        if (limit > 0) {
            query.put("limit", limit);
        }
        if (key != null) {
            query.put(name, key);
        }
        return query;
    }

    /** The query of one page of a list keyed by name: at most {@code limit} items, after {@code after}. */
    static Map<String, Object> after(int limit, String after) {
        return query(limit, "after", after);
    }

    /** Every item of a list, asking for one page at a time until a short one. */
    static <T> Stream<T> every(Function<String, List<T>> list, Function<T, String> key) {
        return Paging.<List<T>>pages(list, items -> items.size() < PAGE ? null : key.apply(items.get(items.size() - 1)))
                .flatMap(List::stream);
    }

    /**
     * Every page of a list, read while the stream is used. {@code next} gives the cursor of the
     * page after a page, or null after the last.
     */
    static <P> Stream<P> pages(Function<String, P> get, Function<P, String> next) {
        Iterator<P> pages = new Iterator<>() {
            private String cursor;
            private boolean more = true;

            @Override
            public boolean hasNext() {
                return more;
            }

            @Override
            public P next() {
                if (!more) {
                    throw new NoSuchElementException();
                }
                P page = get.apply(cursor);
                cursor = next.apply(page);
                more = cursor != null;
                return page;
            }
        };
        return StreamSupport.stream(Spliterators.spliteratorUnknownSize(pages, Spliterator.ORDERED), false);
    }
}
