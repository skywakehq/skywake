using System.Text.Json;

namespace Skywake;

internal static class ErrorReader
{
    internal static SkywakeException From(HttpResponseMessage response, byte[] body)
    {
        var status = (int)response.StatusCode;
        var error = ErrorObject(body);
        var details = new ErrorDetails(
            status,
            Text(error, "code"),
            Text(error, "message") ?? response.ReasonPhrase ?? $"HTTP {status}",
            Text(error, "hint"),
            Text(error, "request_id") ?? Header(response, "x-request-id"),
            Text(error, "path"));
        var conflicts = Conflicts(error);
        return status switch
        {
            401 => new AuthException(details),
            403 => new PermissionException(details),
            404 => new NotFoundException(details),
            409 when conflicts.Count > 0 => new MergeConflictException(details, conflicts),
            409 => new ConflictException(details),
            429 => new RateLimitedException(details, RetryPolicy.RetryAfter(response)),
            >= 500 => new ServerException(details),
            _ => new InvalidRequestException(details),
        };
    }

    private static JsonElement ErrorObject(byte[] body)
    {
        try
        {
            var root = JsonSerializer.Deserialize<JsonElement>(body);
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("error", out var error))
            {
                return default;
            }
            if (error.ValueKind == JsonValueKind.Object)
            {
                return error;
            }
            var code = root.TryGetProperty("code", out var c) ? c : default;
            return JsonSerializer.SerializeToElement(new { message = error, code });
        }
        catch (JsonException)
        {
            return default;
        }
    }

    private static string? Text(JsonElement error, string field) =>
        error.ValueKind == JsonValueKind.Object
        && error.TryGetProperty(field, out var value)
        && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static IReadOnlyList<string> Conflicts(JsonElement error) =>
        error.ValueKind == JsonValueKind.Object
        && error.TryGetProperty("conflicts", out var value)
        && value.ValueKind == JsonValueKind.Array
            ? value.EnumerateArray().Select(item => item.GetString() ?? "").ToList()
            : Array.Empty<string>();

    private static string? Header(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues(name, out var values) ? values.FirstOrDefault() : null;
}
