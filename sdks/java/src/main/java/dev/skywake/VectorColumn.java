package dev.skywake;

import java.util.Map;

/** A vector column. {@code embed}, such as {"model": "..."}, lets the vector be given as text. */
public record VectorColumn(String name, int dims, String metric, String element, Map<String, String> embed) {
    public VectorColumn(String name, int dims) {
        this(name, dims, null, null, null);
    }
}
