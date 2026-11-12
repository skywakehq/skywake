using System.Globalization;

namespace Skywake;

/// <summary>When a failed request is tried again, and how long to wait first.</summary>
internal sealed class RetryPolicy
{
    // Sending these again has the same effect as sending them once.
    private static readonly HashSet<string> Idempotent = new() { "GET", "HEAD", "PUT", "DELETE", "OPTIONS" };

    // The server asks for at most 60 seconds; waiting less would only be refused again.
    private static readonly TimeSpan MaxWait = TimeSpan.FromSeconds(60);

    private readonly int _retries;
    private readonly TimeSpan _backoff;

    internal RetryPolicy(int retries, TimeSpan backoff)
    {
        _retries = retries;
        _backoff = backoff;
    }

    internal static bool IsIdempotent(HttpMethod method) => Idempotent.Contains(method.Method);

    /// <summary>A 429 is always worth another try; a 5xx only when sending again is safe.</summary>
    internal static bool WorthRetrying(int status, bool idempotent) => status == 429 || (idempotent && status >= 500);

    internal bool IsLast(int attempt) => attempt >= _retries;

    /// <summary>How long to wait after an answer: as long as the server asks, else the backoff.</summary>
    internal TimeSpan After(int attempt, HttpResponseMessage response)
    {
        var wait = RetryAfter(response) ?? Backoff(attempt);
        return wait < MaxWait ? wait : MaxWait;
    }

    // Full jitter, so many clients that failed together do not retry together.
    internal TimeSpan Backoff(int attempt)
    {
        var ceiling = Math.Min(MaxWait.TotalSeconds, _backoff.TotalSeconds * Math.Pow(2, attempt));
        return TimeSpan.FromSeconds(Random.Shared.NextDouble() * ceiling);
    }

    private static TimeSpan? RetryAfter(HttpResponseMessage response)
    {
        // Read as sent: .NET only parses whole seconds, and the server may send 0.5.
        if (response.Headers.NonValidated.TryGetValues("Retry-After", out var values)
            && double.TryParse(values.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds)
            && seconds > 0)
        {
            return TimeSpan.FromSeconds(seconds);
        }
        return null;
    }
}
