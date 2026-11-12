package dev.skywake;

import java.util.List;

/**
 * The columns of an index. An {@code id} of "uuid" makes every id a UUID, returned lowercase with
 * dashes; by default an id is a string or a whole number.
 */
public record Schema(List<VectorColumn> vectors, List<Attribute> attributes, String id) {
    public Schema(List<VectorColumn> vectors, List<Attribute> attributes) {
        this(vectors, attributes, null);
    }
}
