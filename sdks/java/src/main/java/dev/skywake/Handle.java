package dev.skywake;

import java.util.List;

abstract class Handle<T extends Handle<T>> {
    final Http http;
    private final String kind;
    private final String name;
    private final String branch;

    Handle(Http http, String kind, String name, String branch) {
        this.http = http;
        this.kind = kind;
        this.name = name;
        this.branch = branch;
    }

    public String name() {
        return name;
    }

    public String branch() {
        return branch;
    }

    public abstract T on(String branch);

    public T fork(String name) {
        return fork(name, null);
    }

    public T fork(String name, String at) {
        http.post(path("/branches"), new Body().with("name", name).with("from", branch).with("at", at));
        return on(name);
    }

    public void destroy() {
        http.delete(Skywake.MAIN.equals(branch) ? path("") : path("/branches/" + Urls.segment(branch)));
    }

    public List<Branch> branches() {
        return Pages.of(http, path("/branches"), new Body(), Branch.class).all();
    }

    String path(String rest) {
        return "/" + kind + "/" + Urls.segment(name) + rest;
    }

    Body on() {
        return new Body().with("branch", branch);
    }
}
