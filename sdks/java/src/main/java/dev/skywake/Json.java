package dev.skywake;

import com.fasterxml.jackson.annotation.JsonAutoDetect.Visibility;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.PropertyAccessor;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.List;

/** How the SDK's types are written to and read from the API's JSON. */
final class Json {
    // Fields left null are not sent, so the server uses its defaults. A null in a map is sent:
    // in a patch it removes an attribute.
    static final ObjectMapper MAPPER = JsonMapper.builder()
            .defaultPropertyInclusion(JsonInclude.Value.construct(JsonInclude.Include.NON_NULL, JsonInclude.Include.ALWAYS))
            .visibility(PropertyAccessor.FIELD, Visibility.ANY)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .build();

    private Json() {}

    static byte[] write(Object value) {
        try {
            return MAPPER.writeValueAsBytes(value);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    static ObjectNode tree(Object value) {
        return MAPPER.valueToTree(value);
    }

    static JsonNode read(InputStream in) throws IOException {
        return MAPPER.readTree(in);
    }

    static <T> T read(String text, Class<T> type) {
        try {
            return MAPPER.readValue(text, type);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    static <T> T as(JsonNode node, Class<T> type) {
        if (absent(node)) {
            return null;
        }
        try {
            return MAPPER.treeToValue(node, type);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    static <T> List<T> listOf(JsonNode node, Class<T> type) {
        if (absent(node)) {
            return List.of();
        }
        return MAPPER.convertValue(node, MAPPER.getTypeFactory().constructCollectionType(List.class, type));
    }

    private static boolean absent(JsonNode node) {
        return node == null || node.isNull() || node.isMissingNode();
    }
}
