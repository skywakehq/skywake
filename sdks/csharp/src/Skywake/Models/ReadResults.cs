using System.Collections;
using System.Text.Json.Serialization;

namespace Skywake;

/// <summary>What a read returns: its items, how long it took and where its reads came from, and what it counted toward the bill.</summary>
public sealed record Results<T>(IReadOnlyList<T> Items, Performance Performance, Billing Billing) : IEnumerable<T>
{
    public IEnumerator<T> GetEnumerator() => Items.GetEnumerator();

    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}

/// <summary>How long a read took and where its reads came from.</summary>
public sealed record Performance(
    [property: JsonPropertyName("server_ms")] int ServerMs,
    [property: JsonPropertyName("cache_temperature")] string? CacheTemperature,
    [property: JsonPropertyName("cache_hit_ratio")] double CacheHitRatio);

/// <summary>What a request counted toward the bill.</summary>
public sealed record Billing(int Queries = 0, int Writes = 0, int Deletes = 0, int Embeddings = 0, int Reranks = 0);

public sealed record Hit(
    object Id,
    double Distance,
    IReadOnlyDictionary<string, object?>? Attributes,
    [property: JsonPropertyName("rerank_score")] double? RerankScore);

/// <summary>The best fragment of a text attribute, with each matched word as [start, end) in UTF-16 code units.</summary>
public sealed record Highlight(string Text, IReadOnlyList<int[]> Marks);

public sealed record SearchHit(
    object Id,
    double Score,
    IReadOnlyDictionary<string, object?>? Attributes,
    IReadOnlyDictionary<string, Highlight>? Highlights,
    [property: JsonPropertyName("rerank_score")] double? RerankScore);

public sealed record FusedHit(
    object Id,
    double Score,
    IReadOnlyDictionary<string, int>? Ranks,
    IReadOnlyDictionary<string, double>? Scores,
    IReadOnlyDictionary<string, object?>? Attributes,
    IReadOnlyDictionary<string, Highlight>? Highlights,
    [property: JsonPropertyName("rerank_score")] double? RerankScore);

public sealed record Row(object Id, IReadOnlyDictionary<string, object?>? Attributes);

public sealed record Ranked(object Id, double Score, IReadOnlyDictionary<string, object?>? Attributes);

public sealed record Group(IReadOnlyDictionary<string, object?> Key, IReadOnlyDictionary<string, object?> Values);

/// <summary>The answer of one request of a multi, in the property it was asked in.</summary>
public sealed record MultiResult(
    IReadOnlyList<Hit>? Query,
    IReadOnlyList<SearchHit>? Search,
    IReadOnlyList<FusedHit>? Hybrid,
    IReadOnlyList<Row>? Order,
    IReadOnlyList<Ranked>? Rank,
    IReadOnlyList<Group>? Aggregate);

/// <summary>How many of the true nearest documents the queries found, as asked and exactly.</summary>
public sealed record RecallResult(double Recall, int Queries, double Found, double Exact);
