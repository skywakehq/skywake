using System.Globalization;

namespace Skywake;

/// <summary>Builds the API's URLs.</summary>
internal static class Urls
{
    /// <summary>The base of every route: <paramref name="url"/> with /v1, whether or not it ended with it.</summary>
    internal static string Base(string url)
    {
        var trimmed = url.TrimEnd('/');
        return (trimmed.EndsWith("/v1", StringComparison.Ordinal) ? trimmed[..^3] : trimmed) + "/v1";
    }

    /// <summary>Keeps a name whole in a URL: index and branch names may hold /.</summary>
    internal static string Escape(string name) => Uri.EscapeDataString(name);

    internal static string Query(IReadOnlyDictionary<string, object>? query) =>
        query is null || query.Count == 0
            ? ""
            : "?" + string.Join("&", query.Select(pair =>
                Escape(pair.Key) + "=" + Escape(Convert.ToString(pair.Value, CultureInfo.InvariantCulture)!)));
}
