namespace Skywake;

/// <summary>What a query searches near: numbers, or text or {"image": url} when the column embeds.</summary>
public sealed record Vector(string Column, object Value);

/// <summary>
/// Finds the TopK nearest documents to a vector that pass a filter, such as
/// {"and": [{"tag": {"eq": "billing"}}, {"price": {"lt": 10}}]}. Recall is the share of the true
/// nearest to find (0.95 by default, 1 is exact); Probe overrides it with a number of clusters.
/// Consistency "eventual" may read what the server saw up to a minute ago, which is faster.
/// </summary>
public sealed record Query(Vector Vector)
{
    public int? TopK { get; init; }
    public double? Recall { get; init; }
    public int? Probe { get; init; }
    public object? Filter { get; init; }
    public IReadOnlyList<string>? Include { get; init; }
    public IReadOnlyList<string>? Exclude { get; init; }
    public int? Offset { get; init; }
    public Per? Per { get; init; }
    public string? Consistency { get; init; }
    public Rerank? Rerank { get; init; }
}

/// <summary>
/// Finds the documents that best match words by BM25. Fields are the text attributes to search
/// (every one by default) and Boosts a weight per field. K1 and B override BM25's parameters.
/// Highlight names text attributes to return the best fragment of. Fuzzy (1 or 2) also matches
/// words that many typos away.
/// </summary>
public sealed record Search(string Query)
{
    public IReadOnlyList<string>? Fields { get; init; }
    public IReadOnlyDictionary<string, double>? Boosts { get; init; }
    public int? TopK { get; init; }
    public double? K1 { get; init; }
    public double? B { get; init; }
    public object? Filter { get; init; }
    public IReadOnlyList<string>? Include { get; init; }
    public IReadOnlyList<string>? Exclude { get; init; }
    public IReadOnlyList<string>? Highlight { get; init; }
    public int? Fuzzy { get; init; }
    public int? Offset { get; init; }
    public Per? Per { get; init; }
    public string? Consistency { get; init; }
    public Rerank? Rerank { get; init; }
}

/// <summary>Reciprocal rank fusion: a hit scores the sum of weight / (K + rank); K is 60 and weights 1 by default.</summary>
public sealed record Fuse
{
    public int? K { get; init; }
    public IReadOnlyDictionary<string, double>? Weights { get; init; }
}

/// <summary>
/// Runs named searches, each a <see cref="Skywake.Query"/> or a <see cref="Skywake.Search"/>, on one
/// snapshot and fuses them by reciprocal rank. Rank scores the hits by an expression instead, such
/// as {"sum": [{"search": "title"}, {"search": "body"}]}.
/// </summary>
public sealed record Hybrid(IReadOnlyDictionary<string, object> Searches)
{
    public int? TopK { get; init; }
    public Fuse Fuse { get; init; } = new();
    public int? Offset { get; init; }
    public Per? Per { get; init; }
    public string? Consistency { get; init; }
    public object? Rank { get; init; }
    public Rerank? Rerank { get; init; }
}

/// <summary>Lists documents in the order of an attribute, or of "id"; those without it come last.</summary>
public sealed record Order(string By)
{
    public bool? Descending { get; init; }
    public int? TopK { get; init; }
    public int? Offset { get; init; }
    public object? Filter { get; init; }
    public IReadOnlyList<string>? Include { get; init; }
    public IReadOnlyList<string>? Exclude { get; init; }
    public string? Consistency { get; init; }
}

/// <summary>
/// Scores every document that passes the filter exactly, such as by
/// {"dot": {"attribute", "indices", "values"}} for sparse vectors or
/// {"max_sim": {"attribute", "vectors"}} for late interaction.
/// </summary>
public sealed record Rank(object Score)
{
    public int? TopK { get; init; }
    public int? Offset { get; init; }
    public object? Filter { get; init; }
    public IReadOnlyList<string>? Include { get; init; }
    public IReadOnlyList<string>? Exclude { get; init; }
    public string? Consistency { get; init; }
}

/// <summary>
/// Measures the documents that pass the filter, in one group or one per set of GroupBy values. Each
/// measure is named, such as {"total": ["count"], "revenue": ["sum", "price"]}; the others are
/// "avg", "min" and "max".
/// </summary>
public sealed record Aggregate(IReadOnlyDictionary<string, IReadOnlyList<string>> Measures)
{
    public IReadOnlyList<string>? GroupBy { get; init; }
    public object? Filter { get; init; }
    public string? Consistency { get; init; }
}

/// <summary>One request of a multi: set one property.</summary>
public sealed record MultiRequest
{
    public Query? Query { get; init; }
    public Search? Search { get; init; }
    public Hybrid? Hybrid { get; init; }
    public Order? Order { get; init; }
    public Rank? Rank { get; init; }
    public Aggregate? Aggregate { get; init; }
}

/// <summary>Keeps at most <see cref="Limit"/> hits for each set of values of <see cref="Attributes"/>.</summary>
public sealed record Per(IReadOnlyList<string> Attributes, int Limit);

/// <summary>Orders hits again with a rerank model, by <see cref="Query"/> or by the request's own text.</summary>
public sealed record Rerank(string Model, string Field)
{
    public string? Query { get; init; }
    public int? TopN { get; init; }
}

/// <summary>Asks how many of the true nearest documents queries find.</summary>
public sealed record RecallCheck
{
    public string? Column { get; init; }
    public int? Queries { get; init; }
    public int? TopK { get; init; }
    public double? Recall { get; init; }
    public object? Filter { get; init; }
}
