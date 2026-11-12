package dev.skywake;

import java.util.List;

/** One page of documents. Pass {@code next} as the cursor of the next page; it is null on the last. */
public record DocumentPage(List<Document> documents, String next) {}
