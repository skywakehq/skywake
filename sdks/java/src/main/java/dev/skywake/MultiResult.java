package dev.skywake;

import java.util.List;

/** The answer of one request of a multi, in the field it was asked in. */
public record MultiResult(
        List<Hit> query,
        List<SearchHit> search,
        List<FusedHit> hybrid,
        List<Row> order,
        List<Ranked> rank,
        List<Group> aggregate) {}
