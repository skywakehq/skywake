using System.Text.Json;
using System.Text.Json.Nodes;

namespace Skywake;

public sealed record IndexSummary(string Name, string Region, DateTimeOffset Created);

public sealed record IndexInfo(
    string Name,
    string Region,
    DateTimeOffset Created,
    JsonObject? Schema,
    long? Rows,
    long? Bytes,
    bool ReadOnly,
    int? RetentionDays,
    IReadOnlyList<string> Branches);

public sealed record Branch(string Name, string? From, DateTimeOffset Created);

public sealed record IndexVersion(string Id, DateTimeOffset Created, long? Rows);

public sealed record IndexMerged(long Rows);

public sealed record Upserted(IReadOnlyList<JsonElement> Ids, long Count);

internal sealed record Counted(long Count);
