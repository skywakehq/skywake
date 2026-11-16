package dev.skywake;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.skywake.FakeApi.Reply;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class SettingsTest {
    @TempDir
    Path home;

    private final Map<String, String> env = new HashMap<>();

    private Skywake.Builder builder() {
        env.put("XDG_CONFIG_HOME", home.toString());
        return Skywake.builder().env(env::get);
    }

    private void credentials(String text) throws Exception {
        Files.createDirectories(home.resolve("skywake"));
        Files.writeString(home.resolve("skywake/credentials.toml"), text);
    }

    private static FakeApi echo() throws Exception {
        return new FakeApi((seen, count) -> Reply.json(Map.of("organization", "o", "environment", "prod")));
    }

    @Test
    void withNothingSetTheErrorSaysHowToSignIn() {
        IllegalStateException error = assertThrows(IllegalStateException.class, () -> builder().build());
        assertTrue(error.getMessage().contains("skywake login"));
        assertTrue(error.getMessage().contains("SKYWAKE_API_KEY"));
    }

    @Test
    void theKeyAndUrlComeFromTheEnvironmentAndTheUrlDefaultsToTheCloud() {
        env.put("SKYWAKE_API_KEY", "sw_env");
        assertEquals("https://api.skywake.dev", builder().build().url());
        env.put("SKYWAKE_URL", "http://localhost:8080/");
        assertEquals("http://localhost:8080", builder().build().url());
    }

    @Test
    void aProfileFromTheCredentialsFileIsUsedWhenNoKeyIsGiven() throws Exception {
        try (FakeApi api = echo()) {
            credentials("[default]\nkey = \"sw_file\"\nurl = \"" + api.url() + "\"\nenvironment = \"prod\"\n\n"
                    + "[staging]\nkey = \"sw_staging\"\nurl = \"" + api.url() + "\"\n");
            assertEquals("prod", builder().build().whoami().environment());
            assertEquals("Bearer sw_file", api.at(0).headers().getFirst("authorization"));
            assertEquals("prod", api.at(0).headers().getFirst("skywake-environment"));
            assertEquals("/v2/whoami", api.at(0).path());
            env.put("SKYWAKE_PROFILE", "staging");
            builder().build().whoami();
            assertEquals("Bearer sw_staging", api.at(1).headers().getFirst("authorization"));
            assertNull(api.at(1).headers().getFirst("skywake-environment"));
        }
    }

    @Test
    void codeBeatsTheEnvironmentWhichBeatsTheFile() throws Exception {
        try (FakeApi api = echo()) {
            credentials("[default]\nkey = \"sw_file\"\nurl = \"http://127.0.0.1:1\"\n");
            env.put("SKYWAKE_API_KEY", "sw_env");
            env.put("SKYWAKE_URL", api.url());
            builder().environment("staging").build().whoami();
            assertEquals("Bearer sw_env", api.at(0).headers().getFirst("authorization"));
            assertEquals("staging", api.at(0).headers().getFirst("skywake-environment"));
            builder().key("sw_code").url(api.url()).build().whoami();
            assertEquals("Bearer sw_code", api.at(1).headers().getFirst("authorization"));
        }
    }
}
