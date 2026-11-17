package dev.skywake;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public final class Disk extends Handle<Disk> {
    private static final int PAGE = 1000;

    Disk(Http http, String name, String branch) {
        super(http, "disks", name, branch);
    }

    @Override
    public Disk on(String branch) {
        return new Disk(http, name(), branch);
    }

    public String read(String path) {
        return read(path, new ReadOptions());
    }

    public String read(String path, ReadOptions options) {
        return new String(readBytes(path, options), StandardCharsets.UTF_8);
    }

    public byte[] readBytes(String path) {
        return readBytes(path, new ReadOptions());
    }

    public byte[] readBytes(String path, ReadOptions options) {
        try (InputStream in = readStream(path, options)) {
            return in.readAllBytes();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    public InputStream readStream(String path, ReadOptions options) {
        return http.open(path("/files/" + Urls.filePath(path)), on().with(options.body()));
    }

    public Committed write(String path, String content) {
        return write(path, content, new WriteOptions());
    }

    public Committed write(String path, byte[] content) {
        return write(path, content, new WriteOptions());
    }

    public Committed write(String path, String content, WriteOptions options) {
        return write(Map.of(path, content), options);
    }

    public Committed write(String path, byte[] content, WriteOptions options) {
        return write(Map.of(path, content), options);
    }

    public Committed write(Map<String, ?> files) {
        return write(files, new WriteOptions());
    }

    public Committed write(Map<String, ?> files, WriteOptions options) {
        List<Body> changes = new ArrayList<>();
        files.forEach((path, content) ->
                changes.add(Changes.of(Urls.clean(path), content, options.executable(), this::part)));
        return commit(changes, options.message());
    }

    public Committed delete(String path) {
        return delete(List.of(path), null);
    }

    public Committed delete(String path, String message) {
        return delete(List.of(path), message);
    }

    public Committed delete(List<String> paths) {
        return delete(paths, null);
    }

    public Committed delete(List<String> paths, String message) {
        List<Body> changes = new ArrayList<>();
        paths.forEach(path -> changes.add(new Body().with("path", Urls.clean(path)).with("delete", true)));
        return commit(changes, message);
    }

    public Committed move(String from, String to) {
        return move(from, to, "Move " + Urls.clean(from) + " to " + Urls.clean(to));
    }

    public Committed move(String from, String to, String message) {
        Body copy = new Body().with("path", Urls.clean(to)).with("from", Map.of("path", Urls.clean(from)));
        Body remove = new Body().with("path", Urls.clean(from)).with("delete", true);
        return commit(List.of(copy, remove), message);
    }

    public Iterable<Entry> entries(String path, ListOptions options) {
        Body query = on().with("path", Urls.clean(path)).with("limit", PAGE).with(options.body());
        return Pages.of(http, path("/files"), query, Entry.class);
    }

    public List<Entry> list() {
        return list("");
    }

    public List<Entry> list(String path) {
        return list(path, new ListOptions());
    }

    public List<Entry> list(String path, ListOptions options) {
        return Pages.all(entries(path, options));
    }

    public Entry stat(String path) {
        return stat(path, null);
    }

    public Entry stat(String path, String at) {
        String target = Urls.clean(path);
        if (target.isEmpty()) {
            return new Entry("", "folder", 0, null, false, null);
        }
        try {
            for (Entry entry : entries(Urls.parent(target), new ListOptions().at(at))) {
                if (entry.path().equals(target)) {
                    return entry;
                }
                if (entry.path().compareTo(target) > 0) {
                    return null;
                }
            }
        } catch (NotFoundException e) {
            info();
        }
        return null;
    }

    public boolean exists(String path) {
        return stat(path) != null;
    }

    public boolean exists(String path, String at) {
        return stat(path, at) != null;
    }

    public List<Match> grep(String pattern) {
        return grep(pattern, new GrepOptions());
    }

    public List<Match> grep(String pattern, GrepOptions options) {
        return search("/grep", new Body().with("pattern", pattern).with(options.body()), Match.class);
    }

    public List<Found> find(String glob) {
        return find(glob, new FindOptions());
    }

    public List<Found> find(String glob, FindOptions options) {
        return search("/find", new Body().with("glob", glob).with(options.body()), Found.class);
    }

    public List<FileHit> query(String text) {
        return query(text, new FileQueryOptions());
    }

    public List<FileHit> query(String text, FileQueryOptions options) {
        return search("/query", new Body().with("text", text).with(options.body()), FileHit.class);
    }

    public DiskMerged mergeInto() {
        return mergeInto(Skywake.MAIN);
    }

    public DiskMerged mergeInto(String into) {
        return mergeInto(into, new MergeOptions());
    }

    public DiskMerged mergeInto(String into, MergeOptions options) {
        Body body = new Body().with("from", branch()).with("into", into).with(options.body());
        return Json.as(http.post(path("/merges"), body), DiskMerged.class);
    }

    public String head() {
        return http.get(path("/branches/" + Urls.segment(branch())), null).path("head").textValue();
    }

    public Iterable<Commit> log() {
        return log(new LogOptions());
    }

    public Iterable<Commit> log(LogOptions options) {
        return Pages.of(http, path("/commits"), options.body().with(on()), Commit.class);
    }

    public List<Change> diff(String against) {
        return Pages.of(http, path("/diff"), on().with("against", against), Change.class).all();
    }

    public Committed revert(String commit) {
        return revert(commit, null);
    }

    public Committed revert(String commit, String message) {
        Body body = new Body().with("commit", commit).with("message", message).with(on());
        return Json.as(http.post(path("/revert"), body), Committed.class);
    }

    public Committed restore(String commit) {
        Body body = new Body().with("to", commit).with(on());
        return Json.as(http.post(path("/restore"), body), Committed.class);
    }

    public Committed restore(Instant time) {
        return restore(commitAt(time));
    }

    public String download(Path dir) {
        return download(dir, null);
    }

    public String download(Path dir, String at) {
        return Folders.download(this, dir, at);
    }

    public String upload(Path dir) {
        return upload(dir, null);
    }

    public String upload(Path dir, String message) {
        return Folders.upload(this, dir, message);
    }

    public DiskInfo info() {
        return Json.as(http.get(path(""), null), DiskInfo.class);
    }

    public DiskInfo configure(DiskSettings settings) {
        return Json.as(http.patch(path(""), settings.body(), null), DiskInfo.class);
    }

    Committed commit(List<Body> changes, String message) {
        Body body = new Body().with("changes", changes).with("message", message).with(on());
        return Json.as(http.post(path("/commits"), body), Committed.class);
    }

    String part(byte[] bytes) {
        return http.upload(path("/uploads"), bytes).path("part").asText();
    }

    private <T> List<T> search(String route, Body body, Class<T> type) {
        List<T> found = new ArrayList<>();
        http.post(path(route), body.with(on())).path("data").forEach(item -> found.add(Json.as(item, type)));
        return found;
    }

    private String commitAt(Instant time) {
        for (Commit commit : log(new LogOptions().limit(1000))) {
            if (!OffsetDateTime.parse(commit.created()).toInstant().isAfter(time)) {
                return commit.id();
            }
        }
        throw new IllegalArgumentException("disk `" + name() + "` has no commit from " + time + " or before");
    }
}
