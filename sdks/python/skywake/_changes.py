import base64
import json

COMMIT_CHANGES = 10_000
COMMIT_BYTES = 32 * 1024 * 1024
INLINE_MAX = 4 * 1024 * 1024
PART_MAX = 16 * 1024 * 1024


def weight(path, size):
    content = -(-size // PART_MAX) * 70 if size > INLINE_MAX else -(-size // 3) * 4
    return len(path) * 6 + 64 + content


def batches(items, weigh):
    batch, size = [], 0
    for item in items:
        heavy = weigh(item)
        if len(batch) == COMMIT_CHANGES or (batch and size + heavy > COMMIT_BYTES):
            yield batch
            batch, size = [], 0
        batch.append(item)
        size += heavy
    if batch:
        yield batch


def as_text(data):
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return None
    return text if len(json.dumps(text).encode()) <= -(-len(data) // 3) * 4 + 2 else None


def inline(path, data, executable=None):
    flags = {} if executable is None else {"executable": executable}
    text = as_text(data)
    if text is None:
        return {"path": path, "base64": base64.b64encode(data).decode(), **flags}
    return {"path": path, "text": text, **flags}


def chunks(data):
    for offset in range(0, len(data), PART_MAX):
        yield data[offset : offset + PART_MAX]
