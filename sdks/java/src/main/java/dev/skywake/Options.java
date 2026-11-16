package dev.skywake;

abstract class Options<T extends Options<T>> {
    private final Body body = new Body();

    @SuppressWarnings("unchecked")
    T set(String name, Object value) {
        body.put(name, value);
        return (T) this;
    }

    Body body() {
        return new Body().with(body);
    }
}
