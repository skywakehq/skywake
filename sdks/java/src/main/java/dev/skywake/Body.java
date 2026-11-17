package dev.skywake;

import java.util.LinkedHashMap;

final class Body extends LinkedHashMap<String, Object> {
    Body with(String name, Object value) {
        if (value != null) {
            put(name, value);
        }
        return this;
    }

    Body with(Body other) {
        putAll(other);
        return this;
    }
}
