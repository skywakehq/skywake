package dev.skywake;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.function.Function;

final class Changes {
    static final int INLINE_MAX = 4 * 1024 * 1024;
    static final int PART_MAX = 16 * 1024 * 1024;
    static final int COMMIT_COUNT = 10_000;
    static final long COMMIT_BYTES = 32L * 1024 * 1024;

    private Changes() {}

    static long weight(String path, long size) {
        long content = size > INLINE_MAX ? ceil(size, PART_MAX) * 70 : ceil(size, 3) * 4;
        return path.length() * 6L + 64 + content;
    }

    static Body of(String path, Object content, Boolean executable, Function<byte[], String> upload) {
        return new Body()
                .with("path", path)
                .with(content(content, upload))
                .with("executable", executable);
    }

    static Body parts(List<String> parts) {
        return new Body().with("parts", parts);
    }

    private static Body content(Object content, Function<byte[], String> upload) {
        if (content instanceof String text && text.length() * 3L <= INLINE_MAX) {
            return new Body().with("text", text);
        }
        byte[] bytes = bytesOf(content);
        if (bytes.length > INLINE_MAX) {
            return parts(upload(bytes, upload));
        }
        String text = asText(bytes);
        return text == null
                ? new Body().with("base64", Base64.getEncoder().encodeToString(bytes))
                : new Body().with("text", text);
    }

    static String asText(byte[] bytes) {
        String text;
        try {
            text = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes))
                    .toString();
        } catch (CharacterCodingException e) {
            return null;
        }
        return Json.bytes(text).length <= ceil(bytes.length, 3) * 4 + 2 ? text : null;
    }

    private static List<String> upload(byte[] bytes, Function<byte[], String> upload) {
        List<String> parts = new ArrayList<>();
        for (int offset = 0; offset < bytes.length; offset += PART_MAX) {
            int end = Math.min(bytes.length, offset + PART_MAX);
            parts.add(upload.apply(Arrays.copyOfRange(bytes, offset, end)));
        }
        return parts;
    }

    private static byte[] bytesOf(Object content) {
        if (content instanceof String text) {
            return text.getBytes(StandardCharsets.UTF_8);
        }
        if (content instanceof byte[] bytes) {
            return bytes;
        }
        throw new IllegalArgumentException("file content must be a String or a byte[]");
    }

    private static long ceil(long value, long by) {
        return (value + by - 1) / by;
    }
}
