using System.Net.Http.Headers;

namespace Skywake;

internal sealed record Payload(byte[] Bytes, string ContentType)
{
    internal static Payload Json(object? value) => new(Skywake.Json.Bytes(value), "application/json");

    internal static Payload Raw(byte[] bytes) => new(bytes, "application/octet-stream");

    internal HttpContent Content()
    {
        var content = new ByteArrayContent(Bytes);
        content.Headers.ContentType = new MediaTypeHeaderValue(ContentType);
        return content;
    }
}
