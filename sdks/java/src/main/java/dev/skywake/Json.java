package dev.skywake;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.SerializerProvider;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.module.SimpleModule;
import com.fasterxml.jackson.databind.ser.std.StdSerializer;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Locale;
import java.util.Map;

final class Json {
    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};

    static final ObjectMapper MAPPER = JsonMapper.builder()
            .propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(MapperFeature.ACCEPT_CASE_INSENSITIVE_ENUMS)
            .addModule(new SimpleModule().addSerializer(enums(), new Lowercase()))
            .build();

    private Json() {}

    static byte[] bytes(Object value) {
        try {
            return MAPPER.writeValueAsBytes(value);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    static JsonNode tree(byte[] bytes) {
        if (bytes.length == 0) {
            return MAPPER.nullNode();
        }
        try {
            return MAPPER.readTree(bytes);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    static <T> T as(JsonNode node, Class<T> type) {
        return MAPPER.convertValue(node, type);
    }

    static Map<String, Object> map(JsonNode node) {
        return MAPPER.convertValue(node, MAP);
    }

    @SuppressWarnings("unchecked")
    private static Class<Enum<?>> enums() {
        return (Class<Enum<?>>) (Class<?>) Enum.class;
    }

    private static final class Lowercase extends StdSerializer<Enum<?>> {
        Lowercase() {
            super(enums());
        }

        @Override
        public void serialize(Enum<?> value, JsonGenerator out, SerializerProvider provider)
                throws IOException {
            out.writeString(value.name().toLowerCase(Locale.ROOT));
        }
    }
}
