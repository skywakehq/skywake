package dev.skywake;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * A typed attribute. A "text" one is searched by BM25 and may set {@code k1} and {@code b}, the
 * {@code language} it is stemmed in ("english" by default, or "none") and whether it drops that
 * language's {@code stopwords}. A {@code filterIndex} keeps the attribute's rows sorted by value, so a
 * filter on it that passes few rows reads only those.
 */
public record Attribute(
        String name,
        String type,
        Double k1,
        Double b,
        String language,
        Boolean stopwords,
        @JsonProperty("filter_index") Boolean filterIndex) {
    public Attribute(String name, String type) {
        this(name, type, null, null, null, null, null);
    }

    /** This attribute with a filter index. */
    public Attribute withFilterIndex() {
        return new Attribute(name, type, k1, b, language, stopwords, true);
    }
}
