namespace Skywake;

public sealed record SkywakeOptions
{
    public string? Key { get; init; }

    public string? Url { get; init; }

    public string? Environment { get; init; }

    public string? Profile { get; init; }

    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(60);

    public int Retries { get; init; } = 3;

    public TimeSpan Backoff { get; init; } = TimeSpan.FromMilliseconds(200);

    public HttpMessageHandler? Handler { get; init; }
}
