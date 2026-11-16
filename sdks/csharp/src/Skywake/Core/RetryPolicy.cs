using System.Globalization;

namespace Skywake;

internal sealed class RetryPolicy
{
    private static readonly HashSet<string> Idempotent = new() { "GET", "HEAD", "PUT", "DELETE", "OPTIONS" };

    private static readonly TimeSpan MaxWait = TimeSpan.FromSeconds(60);

    private readonly int _retries;
    private readonly TimeSpan _backoff;

    internal RetryPolicy(int retries, TimeSpan backoff)
    {
        _retries = retries;
        _backoff = backoff;
    }

    internal static bool IsIdempotent(HttpMethod method) => Idempotent.Contains(method.Method);

    internal static bool WorthRetrying(int status, bool idempotent) => status == 429 || (idempotent && status >= 500);

    internal static TimeSpan? RetryAfter(HttpResponseMessage response) =>
        response.Headers.NonValidated.TryGetValues("Retry-After", out var values)
        && double.TryParse(values.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds)
        && seconds > 0
            ? TimeSpan.FromSeconds(seconds)
            : null;

    internal bool IsLast(int attempt) => attempt >= _retries;

    internal TimeSpan After(int attempt, HttpResponseMessage response)
    {
        var wait = RetryAfter(response) ?? Backoff(attempt);
        return wait < MaxWait ? wait : MaxWait;
    }

    internal TimeSpan Backoff(int attempt)
    {
        var ceiling = Math.Min(MaxWait.TotalSeconds, _backoff.TotalSeconds * Math.Pow(2, attempt));
        return TimeSpan.FromSeconds(Random.Shared.NextDouble() * ceiling);
    }
}
