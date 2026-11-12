using System.Text.Json.Serialization;

namespace Skywake;

public sealed record Branch(string Name, [property: JsonPropertyName("forked_from")] string? ForkedFrom, string? Created);

/// <summary>A branch at one moment of its history.</summary>
public sealed record IndexVersion(string Version, string? Time, long Rows);

/// <summary>A build, warming or collection, and how it went (a collection has no Branch): Status is "running", "succeeded" or "failed".</summary>
public sealed record Operation(
    string Id, string? Index, string? Branch, string? Kind, string Status, string? Error, string? Started, string? Finished);
