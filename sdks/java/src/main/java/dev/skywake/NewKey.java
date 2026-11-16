package dev.skywake;

import java.util.List;

public final class NewKey extends Options<NewKey> {
    public NewKey(String name, Role role) {
        set("name", name).set("role", role).set("environment", null);
    }

    public NewKey environment(String environment) {
        return set("environment", environment);
    }

    public NewKey only(String... names) {
        return set("only", List.of(names));
    }

    public NewKey expiresInDays(int days) {
        return set("expires_in_days", days);
    }
}
