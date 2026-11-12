package dev.skywake;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/** The organization's indexes. */
public final class Indexes {
    private final Transport transport;

    Indexes(Transport transport) {
        this.transport = transport;
    }

    /** Makes an index with an empty main branch. */
    public SearchIndex create(NewIndex index) {
        transport.post("/indexes", index);
        return SearchIndex.main(transport, index.name());
    }

    /** The first page of indexes, in name order. */
    public List<Index> list() {
        return list(0, null);
    }

    /** One page of indexes, in name order: at most {@code limit} (0 is 1000), after the name {@code after}. */
    public List<Index> list(int limit, String after) {
        return Json.listOf(transport.get("/indexes", Paging.after(limit, after)), Index.class);
    }

    /** Every index, a page at a time. */
    public Stream<Index> all() {
        return Paging.every(after -> list(Paging.PAGE, after), Index::name);
    }

    /** The index, with the counts of main. */
    public Index get(String name) {
        return Json.as(transport.get(path(name)), Index.class);
    }

    /** Queries, writes and size per day over the last 14 days, oldest first. */
    public List<UsageDay> usage(String name) {
        return usage(name, 0);
    }

    /** Queries, writes and size per day over the last {@code days} days, oldest first. */
    public List<UsageDay> usage(String name, int days) {
        Map<String, Object> query = days > 0 ? Map.of("days", days) : null;
        return Json.listOf(transport.get(path(name) + "/usage", query).get("days"), UsageDay.class);
    }

    /**
     * Adds attributes, makes the index read-only or writable again, or pins or unpins it. An attribute it has must
     * keep its type.
     */
    public Index update(String name, UpdateIndex update) {
        ObjectNode body = Json.tree(update);
        // A null retention keeps every version and a null pinned unpins; null fields are otherwise left out.
        if (update.keepsAllVersions()) {
            body.putNull("retention_days");
        }
        if (update.unpins()) {
            body.putNull("pinned");
        }
        return Json.as(transport.call("PATCH", path(name), body), Index.class);
    }

    /** Deletes the index, every branch and all its data. */
    public void delete(String name) {
        transport.call("DELETE", path(name), null);
    }

    static String path(String name) {
        return "/indexes/" + Urls.escape(name);
    }
}
