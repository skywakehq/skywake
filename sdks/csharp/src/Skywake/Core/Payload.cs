using System.Net.Http.Headers;

namespace Skywake;

internal sealed record Payload(byte[] Bytes, string ContentType)
{
    internal static Payload Json(object? value) => new(Skywake.Json.Bytes(value), "application/json");

    internal HttpContent Content()
    {
        var content = new ByteArrayContent(Bytes);
        content.Headers.ContentType = new MediaTypeHeaderValue(ContentType);
        return content;
    }
}
