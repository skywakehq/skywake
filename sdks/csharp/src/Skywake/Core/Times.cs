using System.Globalization;

namespace Skywake;

internal static class Times
{
    internal static string Iso(DateTimeOffset time) =>
        time.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
}
