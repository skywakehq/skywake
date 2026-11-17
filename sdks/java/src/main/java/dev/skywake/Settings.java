package dev.skywake;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

record Settings(String key, String url, String environment) {
    static final String DEFAULT_URL = "https://api.skywake.dev";
    private static final String NO_KEY =
            "no Skywake API key: run `skywake login`, set SKYWAKE_API_KEY, or pass a key to the builder";
    private static final Set<String> FIELDS = Set.of("key", "url", "environment");
    private static final Pattern TABLE = Pattern.compile("^\\[\\s*([^\\]]+?)\\s*\\]$");
    private static final Pattern PAIR = Pattern.compile("^([A-Za-z_]+)\\s*=\\s*\"((?:[^\"\\\\]|\\\\.)*)\"$");

    static Settings resolve(Settings asked, String profile, Function<String, String> env) {
        Function<String, String> read = name -> blank(env.apply(name));
        String given = first(asked.key(), read.apply("SKYWAKE_API_KEY"), read.apply("SKYWAKE_KEY"));
        Map<String, String> stored = given != null
                ? Map.of()
                : profile(first(profile, read.apply("SKYWAKE_PROFILE"), "default"), read);
        String key = first(given, stored.get("key"));
        if (key == null) {
            throw new IllegalStateException(NO_KEY);
        }
        return new Settings(
                key,
                first(asked.url(), read.apply("SKYWAKE_URL"), stored.get("url"), DEFAULT_URL),
                first(asked.environment(), read.apply("SKYWAKE_ENV"), stored.get("environment")));
    }

    static Path credentialsPath(Function<String, String> env) {
        boolean windows = System.getProperty("os.name", "").startsWith("Windows");
        if (windows && env.apply("APPDATA") != null) {
            return Path.of(env.apply("APPDATA"), "skywake", "credentials.toml");
        }
        String home = first(env.apply("HOME"), System.getProperty("user.home"));
        String base = first(env.apply("XDG_CONFIG_HOME"), Path.of(home, ".config").toString());
        return Path.of(base, "skywake", "credentials.toml");
    }

    static Map<String, Map<String, String>> parse(String text) {
        Map<String, Map<String, String>> profiles = new HashMap<>();
        Map<String, String> current = null;
        for (String raw : text.split("\\r?\\n")) {
            String line = raw.trim();
            if (line.isEmpty() || line.startsWith("#")) {
                continue;
            }
            Matcher table = TABLE.matcher(line);
            if (table.matches()) {
                current = profiles.computeIfAbsent(table.group(1), name -> new HashMap<>());
                continue;
            }
            Matcher pair = PAIR.matcher(line);
            if (pair.matches() && current != null && FIELDS.contains(pair.group(1))) {
                current.put(pair.group(1), unquote(pair.group(2)));
            }
        }
        return profiles;
    }

    private static String unquote(String escaped) {
        return Json.tree(("\"" + escaped + "\"").getBytes(StandardCharsets.UTF_8)).asText();
    }

    private static Map<String, String> profile(String name, Function<String, String> env) {
        try {
            return parse(Files.readString(credentialsPath(env))).getOrDefault(name, Map.of());
        } catch (IOException | RuntimeException e) {
            return Map.of();
        }
    }

    private static String blank(String value) {
        return value == null || value.isEmpty() ? null : value;
    }

    @SafeVarargs
    private static <T> T first(T... values) {
        for (T value : values) {
            if (value != null) {
                return value;
            }
        }
        return null;
    }
}
