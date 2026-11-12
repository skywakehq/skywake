package dev.skywake;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Iterator;
import java.util.List;

/** What a read returns: its items, how long it took and where its reads came from, and what it counted toward the bill. */
public record Results<T>(List<T> items, Performance performance, Billing billing) implements Iterable<T> {
    @Override
    public Iterator<T> iterator() {
        return items.iterator();
    }

    /** The list in {@code field} of a read's answer, with its performance and billing. */
    static <T> Results<T> from(JsonNode answer, String field, Class<T> type) {
        Performance performance = Json.as(answer.get("performance"), Performance.class);
        Billing billing = Json.as(answer.get("billing"), Billing.class);
        return new Results<>(
                Json.listOf(answer.get(field), type),
                performance != null ? performance : new Performance(0, null, 0),
                billing != null ? billing : new Billing(0, 0, 0, 0, 0));
    }
}
