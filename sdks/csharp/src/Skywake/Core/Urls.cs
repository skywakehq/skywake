using System.Globalization;

namespace Skywake;

internal static class Urls
{
    internal static string Segment(string name) => Uri.EscapeDataString(name);

    internal static string Root(string url)
    {
        var trimmed = url.TrimEnd('/');
        return trimmed.EndsWith("/v1", StringComparison.Ordinal) || trimmed.EndsWith("/v2", StringComparison.Ordinal)
            ? trimmed[..^3]
            : trimmed;
    }

    internal static string Query(IReadOnlyDictionary<string, object?>? query)
    {
        var pairs = (query ?? new Dictionary<string, object?>())
            .Where(pair => pair.Value is not null)
            .Select(pair => Uri.EscapeDataString(pair.Key) + "=" + Uri.EscapeDataString(Text(pair.Value!)))
            .ToList();
        return pairs.Count == 0 ? "" : "?" + string.Join("&", pairs);
    }

    private static string Text(object value) => value switch
    {
        bool flag => flag ? "true" : "false",
        IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString()!,
    };
}
