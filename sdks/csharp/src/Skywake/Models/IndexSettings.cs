using System.Text.Json.Serialization;

namespace Skywake;

/// <summary>
/// The columns of an index. An Id of "uuid" makes every id a UUID, returned lowercase with dashes;
/// by default an id is a string or a whole number.
/// </summary>
public sealed record Schema(IReadOnlyList<VectorColumn> Vectors, IReadOnlyList<AttributeColumn> Attributes)
{
    public string? Id { get; init; }
}

/// <summary>A vector column. Embed, such as {"model": "..."}, lets the vector be given as text.</summary>
public sealed record VectorColumn(string Name, int Dims)
{
    public string? Metric { get; init; }
    public string? Element { get; init; }
    public IReadOnlyDictionary<string, string>? Embed { get; init; }
}

/// <summary>
/// A typed attribute. A "text" one is searched by BM25 and may set K1 and B, the Language it is
/// stemmed in ("english" by default, or "none") and whether it drops that language's Stopwords.
/// A FilterIndex keeps the attribute's rows sorted by value, so a filter on it that passes few rows
/// reads only those.
/// </summary>
public sealed record AttributeColumn(string Name, string Type)
{
    public double? K1 { get; init; }
    public double? B { get; init; }
    public string? Language { get; init; }
    public bool? Stopwords { get; init; }

    [JsonPropertyName("filter_index")]
    public bool? FilterIndex { get; init; }
}

/// <summary>Names a key in your cloud's key service that encrypts the index.</summary>
public sealed record Encryption([property: JsonPropertyName("kms_key_id")] string KmsKeyId);

/// <summary>Servers reserved for an index, billed per GB-hour for each replica instead of per query.</summary>
public sealed record Pinned(int Replicas);

/// <summary>Where an index is pinned: fewer replicas than asked while fewer servers run.</summary>
public sealed record Pinning(IReadOnlyList<PinnedReplica> Replicas);

/// <summary>A server holding a pinned index; Warm once every object of the current version is on its disk.</summary>
public sealed record PinnedReplica(string Server, bool Warm, [property: JsonPropertyName("in_flight")] int InFlight);

/// <summary>Makes an index. Shards splits the documents (1 by default).</summary>
public sealed record NewIndex(string Name, Schema Schema)
{
    public string? Region { get; init; }
    public int? Shards { get; init; }
    public Encryption? Encryption { get; init; }
    public Pinned? Pinned { get; init; }
}

/// <summary>Adds attributes, makes the index read-only or writable again, or pins it, on every branch.</summary>
public sealed record UpdateIndex
{
    public IReadOnlyList<AttributeColumn>? Attributes { get; init; }

    [JsonPropertyName("read_only")]
    public bool? ReadOnly { get; init; }

    /// <summary>How long older versions stay after they were replaced. Set KeepAllVersions instead to keep every one.</summary>
    [JsonPropertyName("retention_days")]
    public int? RetentionDays { get; init; }

    [JsonIgnore]
    public bool KeepAllVersions { get; init; }

    /// <summary>The servers to pin the index to. Set Unpin instead to unpin it.</summary>
    public Pinned? Pinned { get; init; }

    [JsonIgnore]
    public bool Unpin { get; init; }
}

/// <summary>Copies a branch to a new index, as its main.</summary>
public sealed record CopyIndex(string Name)
{
    public string? Region { get; init; }
    public Encryption? Encryption { get; init; }
}

/// <summary>
/// An index's settings. Pinned is null when it is not pinned. Stats, of main, and Pinning are only read by
/// GetAsync; Stats is null while the server cannot count them.
/// </summary>
public sealed record IndexInfo(
    string Name,
    string? Region,
    Schema? Schema,
    int Shards,
    Encryption? Encryption,
    [property: JsonPropertyName("read_only")] bool ReadOnly,
    // Null when every version is kept.
    [property: JsonPropertyName("retention_days")] int? RetentionDays,
    Pinned? Pinned,
    string? Created,
    Stats? Stats,
    Pinning? Pinning);

/// <summary>A branch's counts.</summary>
public sealed record Stats(
    long Rows,
    [property: JsonPropertyName("deleted_rows")] long DeletedRows,
    long Segments,
    [property: JsonPropertyName("indexed_rows")] long IndexedRows,
    [property: JsonPropertyName("unindexed_rows")] long UnindexedRows,
    long Clusters,
    long Bytes);

/// <summary>One day of an index's use. Rows and Bytes are null on days the index was not counted.</summary>
public sealed record UsageDay(
    string Day, long Queries, long Writes, long Deletes, long Embeddings, long Reranks, long? Rows, long? Bytes);
