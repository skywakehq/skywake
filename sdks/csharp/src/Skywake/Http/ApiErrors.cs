using System.Text.Json;

namespace Skywake;

/// <summary>Turns the API's error answers into <see cref="SkywakeException"/>.</summary>
internal static class ApiErrors
{
    /// <summary>Throws the answer's error, if it is one.</summary>
    internal static async Task ThrowIfErrorAsync(HttpResponseMessage response, CancellationToken ct)
    {
        if (response.IsSuccessStatusCode)
        {
            return;
        }
        var text = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        string message = text;
        string? code = null, requestId = null, path = null;
        try
        {
            using var document = JsonDocument.Parse(text);
            var body = document.RootElement;
            if (body.ValueKind == JsonValueKind.Object
                && body.TryGetProperty("error", out var error)
                && error.ValueKind == JsonValueKind.String)
            {
                message = error.GetString()!;
                code = Text(body, "code");
                requestId = Text(body, "request_id");
                path = Text(body, "path");
            }
        }
        catch (JsonException)
        {
            // The message stays the text of the answer.
        }
        requestId ??= response.Headers.TryGetValues("x-request-id", out var ids) ? ids.FirstOrDefault() : null;
        throw new SkywakeException((int)response.StatusCode, message, code, requestId, path);
    }

    private static string? Text(JsonElement body, string field) =>
        body.TryGetProperty(field, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
