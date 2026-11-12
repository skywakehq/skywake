package dev.skywake;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.ToIntFunction;
import java.util.stream.Stream;

/** One branch of a search index: main unless {@link #at} picked another. */
public final class SearchIndex {
    /** The most documents or ids the API takes in one request. */
    static final int BATCH = 1000;

    private final Transport transport;
    private final String name;
    private final String branch;
    private final String path;
    private final String branchPath;

    private SearchIndex(Transport transport, String name, String branch) {
        this.transport = transport;
        this.name = name;
        this.branch = branch;
        this.path = Indexes.path(name);
        this.branchPath = path + "/branches/" + Urls.escape(branch);
    }

    static SearchIndex main(Transport transport, String name) {
        return new SearchIndex(transport, name, "main");
    }

    public String name() {
        return name;
    }

    public String branch() {
        return branch;
    }

    /** The same index on another branch. */
    public SearchIndex at(String branch) {
        return new SearchIndex(transport, name, branch);
    }

    /** Writes documents, 1000 to a request. Each replaces any earlier one with its id. Returns how many were written. */
    public int upsert(List<Document> documents) {
        return batched(documents, part -> written("documents", Map.of("documents", part)));
    }

    /** Deletes documents by id, 1000 to a request. Ids that are not there are ignored. */
    public int delete(List<?> ids) {
        return batched(ids, part -> written("documents/delete", Map.of("ids", part)));
    }

    /** Applies upserts, patches and deletes as one change. */
    public WriteCounts write(Write write) {
        return post("write", write, WriteCounts.class);
    }

    /** Sets attributes of documents, 1000 to a request; a null value removes one. Missing documents are skipped. */
    public int patch(List<Patch> patches) {
        return batched(patches, part -> write(new Write().patches(part)).patched());
    }

    /** Deletes every document that passes {@code filter} and returns how many. */
    public int deleteBy(Object filter) {
        return write(new Write().deleteBy(filter)).deleted();
    }

    /** The nearest documents to a vector, nearest first. */
    public Results<Hit> query(Query query) {
        return read("query", "hits", query, Hit.class);
    }

    /** The documents that best match words by BM25, best first. */
    public Results<SearchHit> search(Search search) {
        return read("search", "hits", search, SearchHit.class);
    }

    /** Named searches on one snapshot, fused by reciprocal rank. */
    public Results<FusedHit> hybrid(Hybrid hybrid) {
        return read("hybrid", "hits", hybrid, FusedHit.class);
    }

    /** Documents in the order of an attribute, or of "id"; those without it come last. */
    public Results<Row> order(Order order) {
        return read("order", "rows", order, Row.class);
    }

    /** The documents that pass the filter, best first by an exact score. Those scoring 0 are left out. */
    public Results<Ranked> rank(Rank rank) {
        return read("rank", "hits", rank, Ranked.class);
    }

    /** Counts, sums, averages and finds the least and most. */
    public Results<Group> aggregate(Aggregate aggregate) {
        return read("aggregate", "groups", aggregate, Group.class);
    }

    /** Several requests on one snapshot. */
    public Results<MultiResult> multi(List<MultiRequest> requests) {
        return multi(requests, null);
    }

    /** Several requests on one snapshot. A request may not set its own consistency; set it here. */
    public Results<MultiResult> multi(List<MultiRequest> requests, String consistency) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("requests", requests);
        if (consistency != null) {
            body.put("consistency", consistency);
        }
        return read("multi", "results", body, MultiResult.class);
    }

    /**
     * Every document as it is now, in no set order, read as the stream is used. Close the stream
     * (try-with-resources) if you stop early.
     */
    public Stream<Document> export() {
        InputStream body = transport.open(branchPath + "/export", null);
        // The answer is one document per line.
        BufferedReader lines = new BufferedReader(new InputStreamReader(body, StandardCharsets.UTF_8));
        return lines.lines()
                .filter(line -> !line.isBlank())
                .map(line -> Json.read(line, Document.class))
                .onClose(() -> Answer.close(body));
    }

    /** Every document as it is now, as the bytes of a Parquet file read as they arrive. Close it when done. */
    public InputStream exportParquet() {
        return transport.open(branchPath + "/export", Map.of("format", "parquet"));
    }

    /** Copies this branch to a new index, as its main. */
    public SearchIndex copy(CopyIndex to) {
        ObjectNode body = Json.tree(to);
        body.put("branch", branch);
        transport.post(path + "/copy", body);
        return main(transport, to.name());
    }

    /** The document with {@code id}. A missing one throws a 404, as a missing index or branch does. */
    public Document get(Object id) {
        return Json.as(transport.get(branchPath + "/documents/" + Urls.escape(String.valueOf(id))), Document.class);
    }

    /** The first page of documents by id, number ids first. */
    public DocumentPage documents() {
        return documents(0, null);
    }

    /**
     * One page of documents by id, number ids first: at most {@code limit} (0 is 100), from
     * {@code cursor}, the {@code next} of the page before. It reads every segment, so it is for browsing.
     */
    public DocumentPage documents(int limit, String cursor) {
        return Json.as(transport.get(branchPath + "/documents", Paging.query(limit, "cursor", cursor)), DocumentPage.class);
    }

    /** Every document, a page at a time. */
    public Stream<Document> allDocuments() {
        return Paging.<DocumentPage>pages(cursor -> documents(Paging.PAGE, cursor),
                        page -> page.next() == null || page.next().isEmpty() ? null : page.next())
                .flatMap(page -> page.documents().stream());
    }

    /** Forks this branch as {@code name}. Nothing is copied. */
    public SearchIndex fork(String name) {
        return forked(Map.of("name", name, "from", branch));
    }

    /** Forks this branch as {@code name} at an older {@code version} of it. Nothing is copied. */
    public SearchIndex fork(String name, String version) {
        return forked(Map.of("name", name, "from", branch, "at", version));
    }

    /** The first page of this branch's versions, newest first: one for every change. */
    public List<Version> versions() {
        return versions(0, null);
    }

    /** One page of this branch's versions, newest first: at most {@code limit} (0 is 20), after the version {@code after}. */
    public List<Version> versions(int limit, String after) {
        return Json.listOf(transport.get(branchPath + "/versions", Paging.after(limit, after)), Version.class);
    }

    /** Moves this branch back to an older version, as a new version, which it returns. The history stays. */
    public Version restore(String version) {
        return post("restore", Map.of("version", version), Version.class);
    }

    /**
     * Starts deleting the data of the whole index that no branch uses, nor any version within its
     * retention. Returns the operation {@link #operation} follows.
     */
    public Operation collect() {
        return Json.as(transport.post(path + "/collect", null), Operation.class);
    }

    /** This branch's counts, or null while the server cannot count them. */
    public Stats stats() {
        return Json.as(transport.get(branchPath).get("stats"), Stats.class);
    }

    /** Starts clustering this branch's rows. It answers before the build ends, with an operation {@link #operation} follows. */
    public Operation build() {
        return post("build", null, Operation.class);
    }

    /**
     * Adds the writes of {@code branch} since it forked, or was last merged here, to this branch,
     * and returns how many rows it added. Where both wrote one document, {@code branch}'s write wins.
     */
    public int merge(String branch) {
        return transport.post(branchPath + "/merge", Map.of("from", branch)).path("rows").asInt();
    }

    /** Starts reading this branch into the cache, so the next queries are fast. */
    public Operation warm() {
        return post("warm", null, Operation.class);
    }

    /** A build or warming of this index, and how it went. */
    public Operation operation(String id) {
        return Json.as(transport.get(path + "/operations/" + Urls.escape(id)), Operation.class);
    }

    /** Queries with the vectors of documents picked at random, as asked and exactly, and compares them. */
    public Recall recall(RecallCheck check) {
        return post("recall", check, Recall.class);
    }

    /** The first page of the index's branches, in name order. */
    public List<Branch> branches() {
        return branches(0, null);
    }

    /** One page of the index's branches, in name order: at most {@code limit} (0 is 1000), after the name {@code after}. */
    public List<Branch> branches(int limit, String after) {
        return Json.listOf(transport.get(path + "/branches", Paging.after(limit, after)), Branch.class);
    }

    /** Every branch, a page at a time. */
    public Stream<Branch> allBranches() {
        return Paging.every(after -> branches(Paging.PAGE, after), Branch::name);
    }

    /** Deletes this branch. main stays while the index does. */
    public void deleteBranch() {
        transport.call("DELETE", branchPath, null);
    }

    private SearchIndex forked(Map<String, String> body) {
        transport.post(path + "/branches", body);
        return at(body.get("name"));
    }

    private <T> T post(String route, Object body, Class<T> type) {
        return Json.as(transport.post(branchPath + "/" + route, body), type);
    }

    /** Posts a read and returns the list in its answer's field. */
    private <T> Results<T> read(String route, String field, Object body, Class<T> type) {
        return Results.from(transport.post(branchPath + "/" + route, body), field, type);
    }

    /** Sends items 1000 at a time and sums what each answer counts. */
    private static <T> int batched(List<T> items, ToIntFunction<List<T>> send) {
        int total = 0;
        for (int start = 0; start < items.size(); start += BATCH) {
            total += send.applyAsInt(items.subList(start, Math.min(start + BATCH, items.size())));
        }
        return total;
    }

    private int written(String route, Object body) {
        return transport.post(branchPath + "/" + route, body).path("count").asInt();
    }
}
