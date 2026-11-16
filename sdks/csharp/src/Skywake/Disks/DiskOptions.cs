namespace Skywake;

public enum FindKind
{
    Any,
    Files,
    Folders,
}

public enum Prefer
{
    Ours,
    Theirs,
}

public sealed record NewDiskOptions
{
    public string? Region { get; init; }

    public bool? Search { get; init; }

    public Visibility? Visibility { get; init; }
}

public sealed record ReadOptions
{
    public string? At { get; init; }

    public long? Offset { get; init; }

    public long? Length { get; init; }
}

public sealed record WriteOptions
{
    public string? Message { get; init; }

    public bool? Executable { get; init; }
}

public sealed record ListOptions
{
    public bool Recursive { get; init; }

    public string? At { get; init; }
}

public sealed record GrepOptions
{
    public string? Path { get; init; }

    public string? Glob { get; init; }

    public bool? IgnoreCase { get; init; }

    public int? Limit { get; init; }

    public string? At { get; init; }
}

public sealed record FindOptions
{
    public string? Path { get; init; }

    public FindKind? Kind { get; init; }

    public int? Limit { get; init; }

    public string? At { get; init; }
}

public sealed record DiskQueryOptions
{
    public int? Limit { get; init; }

    public string? Path { get; init; }
}

public sealed record MergeOptions
{
    public string? Message { get; init; }

    public bool? DryRun { get; init; }

    public Prefer? Prefer { get; init; }
}

public sealed record LogOptions
{
    public string? Path { get; init; }

    public int? Limit { get; init; }
}

public sealed record DiskSettings
{
    public bool? Search { get; init; }

    public Visibility? Visibility { get; init; }
}
