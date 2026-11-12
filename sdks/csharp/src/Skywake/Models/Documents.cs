using System.Text.Json.Serialization;

namespace Skywake;

/// <summary>A document as written and read. Its id is a string, or a whole number from 0. A vector may be text, or {"image": url}, when its column embeds.</summary>
public sealed record Document(
    object Id,
    IReadOnlyDictionary<string, object?>? Vectors = null,
    IReadOnlyDictionary<string, object?>? Attributes = null);

/// <summary>Sets attributes of a document; a null value removes one.</summary>
public sealed record Patch(object Id, IReadOnlyDictionary<string, object?> Attributes);

/// <summary>Sets attributes of every document that passes <see cref="Filter"/>.</summary>
public sealed record PatchBy(object Filter, IReadOnlyDictionary<string, object?> Attributes);

/// <summary>
/// Upserts, patches and deletes as one change, in this order: DeleteBy, PatchBy, Upserts, Patches,
/// Deletes. A condition is a filter checked against each document as it was, whose values may be
/// {"$ref_new": attribute}, such as {"version": {"lt": {"$ref_new": "version"}}}.
/// </summary>
public sealed record Write
{
    public IReadOnlyList<Document>? Upserts { get; init; }
    public IReadOnlyList<Patch>? Patches { get; init; }
    public IReadOnlyList<object>? Deletes { get; init; }
    public object? UpsertIf { get; init; }
    public object? PatchIf { get; init; }
    public object? DeleteIf { get; init; }
    public object? DeleteBy { get; init; }
    public PatchBy? PatchBy { get; init; }

    /// <summary>Also returns the ids behind the counts.</summary>
    public bool? ReturnAffectedIds { get; init; }
}

/// <summary>What a write did. The ids are there when the write set ReturnAffectedIds.</summary>
public sealed record WriteCounts(
    int Upserted,
    int Patched,
    int Deleted,
    [property: JsonPropertyName("upserted_ids")] IReadOnlyList<object>? UpsertedIds,
    [property: JsonPropertyName("patched_ids")] IReadOnlyList<object>? PatchedIds,
    [property: JsonPropertyName("deleted_ids")] IReadOnlyList<object>? DeletedIds,
    Billing? Billing);

/// <summary>One page of documents. Pass Next as the cursor of the next page; it is null on the last.</summary>
public sealed record DocumentPage(IReadOnlyList<Document> Documents, string? Next);
