package dev.skywake;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public final class Index extends Handle<Index> {
    private static final int UPSERT_COUNT = 10_000;
    private static final long UPSERT_BYTES = 24L * 1024 * 1024;
    private static final int PAGE = 1000;

    Index(Http http, String name, String branch) {
        super(http, "indexes", name, branch);
    }

    @Override
    public Index on(String branch) {
        return new Index(http, name(), branch);
    }

    public Upserted upsert(Map<String, ?> row) {
        return upsert(List.of(row));
    }

    public Upserted upsert(List<? extends Map<String, ?>> rows) {
        List<Map<String, ?>> all = new ArrayList<>(rows);
        List<Object> ids = new ArrayList<>();
        long count = 0;
        for (List<Map<String, ?>> batch : Batches.of(all, UPSERT_COUNT, UPSERT_BYTES, Index::weight)) {
            Upserted done = Json.as(http.post(path("/rows"), batch, on()), Upserted.class);
            ids.addAll(done.ids());
            count += done.count();
        }
        return new Upserted(ids, count);
    }

    public long update(Object target, Map<String, ?> fields) {
        Body body = Targets.of(target).with("fields", fields);
        return http.patch(path("/rows"), body, on()).path("count").asLong();
    }

    public long delete(Object target) {
        return http.post(path("/rows/delete"), Targets.of(target), on()).path("count").asLong();
    }

    public Map<String, Object> get(Object id) {
        try {
            return Json.map(http.get(path("/rows/" + Urls.segment(id)), on()));
        } catch (NotFoundException e) {
            if ("id".equals(e.path())) {
                return null;
            }
            throw e;
        }
    }

    public List<Map<String, Object>> query(String text) {
        return query(text, new QueryOptions());
    }

    public List<Map<String, Object>> query(QueryOptions options) {
        return query(null, options);
    }

    public List<Map<String, Object>> query(String text, QueryOptions options) {
        Body body = new Body().with("text", text).with(options.body()).with(on());
        return maps(http.post(path("/query"), body).path("data"));
    }

    public long count() {
        return count(null);
    }

    public long count(Map<String, ?> filter) {
        Body body = new Body().with("filter", filter).with(on());
        return http.post(path("/count"), body).path("count").asLong();
    }

    public List<Map<String, Object>> aggregate(Aggregation aggregation) {
        return maps(http.post(path("/aggregate"), aggregation.body().with(on())).path("data"));
    }

    public Iterable<Map<String, Object>> rows() {
        return Pages.of(http, path("/rows"), on().with("limit", PAGE), Json::map);
    }

    public Iterable<Map<String, Object>> rows(Map<String, ?> filter) {
        return new Pages<>(after -> matching(filter, after), Index::withoutScore);
    }

    public IndexMerged mergeInto() {
        return mergeInto(Skywake.MAIN);
    }

    public IndexMerged mergeInto(String into) {
        Body body = new Body().with("from", branch()).with("into", into);
        return Json.as(http.post(path("/merges"), body), IndexMerged.class);
    }

    public List<Version> versions() {
        return Pages.of(http, path("/versions"), on(), Version.class).all();
    }

    public Version restore(String version) {
        Body body = new Body().with("to", version).with(on());
        return Json.as(http.post(path("/restore"), body), Version.class);
    }

    public Version restore(Instant time) {
        return restore(time.toString());
    }

    public Index copy(String name) {
        return copy(name, null);
    }

    public Index copy(String name, String environment) {
        http.post(path("/copy"), new Body().with("name", name).with("environment", environment));
        return new Index(environment == null ? http : http.in(environment), name, Skywake.MAIN);
    }

    public IndexInfo info() {
        return Json.as(http.get(path(""), null), IndexInfo.class);
    }

    public IndexInfo configure(IndexSettings settings) {
        return Json.as(http.patch(path(""), settings.body(), null), IndexInfo.class);
    }

    private JsonNode matching(Map<String, ?> filter, String after) {
        Object where = after == null ? filter : Map.of("and", List.of(filter, idAbove(after)));
        Body body = new Body().with("filter", where).with("limit", PAGE).with(on());
        JsonNode hits = http.post(path("/query"), body).path("data");
        ObjectNode page = Json.MAPPER.createObjectNode().set("data", hits);
        if (hits.size() == PAGE) {
            page.put("next", hits.get(PAGE - 1).path("id").toString());
        }
        return page;
    }

    private static Map<String, Object> idAbove(String after) {
        return Map.of("id", Map.of("gt", Json.tree(after.getBytes(StandardCharsets.UTF_8))));
    }

    private static long weight(Map<String, ?> row) {
        return Json.bytes(row).length;
    }

    private static Map<String, Object> withoutScore(JsonNode hit) {
        Map<String, Object> row = Json.map(hit);
        row.remove("score");
        return row;
    }

    private static List<Map<String, Object>> maps(JsonNode items) {
        List<Map<String, Object>> found = new ArrayList<>();
        items.forEach(item -> found.add(Json.map(item)));
        return found;
    }
}
