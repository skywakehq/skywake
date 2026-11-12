package dev.skywake;

/** One request of a multi: build it with {@code of}. */
public record MultiRequest(Query query, Search search, Hybrid hybrid, Order order, Rank rank, Aggregate aggregate) {
    public static MultiRequest of(Query query) {
        return new MultiRequest(query, null, null, null, null, null);
    }

    public static MultiRequest of(Search search) {
        return new MultiRequest(null, search, null, null, null, null);
    }

    public static MultiRequest of(Hybrid hybrid) {
        return new MultiRequest(null, null, hybrid, null, null, null);
    }

    public static MultiRequest of(Order order) {
        return new MultiRequest(null, null, null, order, null, null);
    }

    public static MultiRequest of(Rank rank) {
        return new MultiRequest(null, null, null, null, rank, null);
    }

    public static MultiRequest of(Aggregate aggregate) {
        return new MultiRequest(null, null, null, null, null, aggregate);
    }
}
