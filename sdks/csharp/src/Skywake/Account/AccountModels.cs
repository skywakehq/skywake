namespace Skywake;

public enum Role
{
    Read,
    Write,
    Admin,
}

public sealed record Whoami(
    string Organization,
    string? Environment,
    Role Role,
    IReadOnlyList<string>? Only,
    string? Key,
    string? User,
    string? Email,
    DateTimeOffset? Expires);

public sealed record ApiKey(
    string Id,
    string Name,
    Role Role,
    string? Environment,
    IReadOnlyList<string>? Only,
    DateTimeOffset? Expires,
    DateTimeOffset? LastUsed,
    DateTimeOffset Created,
    string? CreatedBy);

public sealed record CreatedKey(string Id, string Key);

public sealed record EnvironmentInfo(string Name, DateTimeOffset Created);

public sealed record NewKey(string Name, Role Role)
{
    public string? Environment { get; init; }

    public IReadOnlyList<string>? Only { get; init; }

    public int? ExpiresInDays { get; init; }
}
