namespace Skywake;

public enum QueryMode
{
    Auto,
    Meaning,
    Keywords,
}

public enum SortOrder
{
    Asc,
    Desc,
}

public sealed record QueryOptions
{
    public IReadOnlyList<float>? Vector { get; init; }

    public object? Filter { get; init; }

    public int? Limit { get; init; }

    public QueryMode? Mode { get; init; }

    public IReadOnlyDictionary<string, SortOrder>? Sort { get; init; }

    public IReadOnlyList<string>? Fields { get; init; }
}

public sealed record AggregateOptions
{
    public IReadOnlyList<string>? GroupBy { get; init; }

    public bool? Count { get; init; }

    public IReadOnlyList<string>? Sum { get; init; }

    public IReadOnlyList<string>? Avg { get; init; }

    public IReadOnlyList<string>? Min { get; init; }

    public IReadOnlyList<string>? Max { get; init; }

    public object? Filter { get; init; }
}

public sealed record IndexSettings
{
    public bool? ReadOnly { get; init; }

    public int? RetentionDays { get; init; }

    public object? Pinned { get; init; }

    public IReadOnlyList<object>? Attributes { get; init; }

    public IReadOnlyList<string>? DropAttributes { get; init; }
}

public sealed record NewIndexOptions
{
    public object? Schema { get; init; }

    public string? Region { get; init; }

    public object? Embed { get; init; }
}
