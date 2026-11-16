package dev.skywake;

import java.util.ArrayList;
import java.util.List;
import java.util.function.ToLongFunction;

final class Batches {
    private Batches() {}

    static <T> List<List<T>> of(List<T> items, int count, long bytes, ToLongFunction<T> weigh) {
        List<List<T>> batches = new ArrayList<>();
        List<T> batch = new ArrayList<>();
        long size = 0;
        for (T item : items) {
            long weight = weigh.applyAsLong(item);
            if (batch.size() == count || (!batch.isEmpty() && size + weight > bytes)) {
                batches.add(batch);
                batch = new ArrayList<>();
                size = 0;
            }
            batch.add(item);
            size += weight;
        }
        if (!batch.isEmpty()) {
            batches.add(batch);
        }
        return batches;
    }
}
