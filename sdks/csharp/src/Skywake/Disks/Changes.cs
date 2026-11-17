using System.Text.Json.Nodes;

namespace Skywake;

internal delegate Task<string> PartUpload(byte[] bytes, CancellationToken ct);

internal static class Changes
{
    internal const int CommitCount = 10_000;
    internal const long CommitBytes = 32L * 1024 * 1024;
    internal const int InlineMax = 4 * 1024 * 1024;
    internal const int PartMax = 16 * 1024 * 1024;

    internal static long Weight(string path, long size)
    {
        var content = size > InlineMax ? (size + PartMax - 1) / PartMax * 70 : (size + 2) / 3 * 4;
        return path.Length * 6 + 64 + content;
    }

    internal static async Task<JsonObject> OfAsync(
        string path, FileContent content, PartUpload upload, bool? executable, CancellationToken ct)
    {
        if (content.Text is { } text && (long)text.Length * 3 <= InlineMax)
        {
            return With(path, "text", text, executable);
        }
        var bytes = content.Bytes;
        if (bytes.Length > InlineMax)
        {
            return With(path, "parts", await UploadPartsAsync(bytes, upload, ct).ConfigureAwait(false), executable);
        }
        return Utf8Text.AsText(bytes) is { } decoded
            ? With(path, "text", decoded, executable)
            : With(path, "base64", Convert.ToBase64String(bytes), executable);
    }

    internal static JsonObject With(string path, string field, object value, bool? executable) =>
        Json.Object(("path", path), (field, value), ("executable", executable));

    internal static JsonObject Deleted(string path) => Json.Object(("path", path), ("delete", true));

    internal static JsonObject Copied(string from, string to) =>
        Json.Object(("path", to), ("from", Json.Object(("path", from))));

    private static async Task<List<string>> UploadPartsAsync(byte[] bytes, PartUpload upload, CancellationToken ct)
    {
        var parts = new List<string>();
        for (var offset = 0; offset < bytes.Length; offset += PartMax)
        {
            parts.Add(await upload(bytes[offset..Math.Min(bytes.Length, offset + PartMax)], ct).ConfigureAwait(false));
        }
        return parts;
    }
}
