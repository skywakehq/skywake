namespace Skywake;

public enum Visibility
{
    Private,
    Public,
}

public enum EntryKind
{
    File,
    Folder,
    Symlink,
}

public enum ChangeKind
{
    Added,
    Removed,
    Modified,
}

public sealed record DiskSummary(string Name, string Region, Visibility Visibility, DateTimeOffset Created);

public sealed record DiskInfo(
    string Name,
    string Region,
    Visibility Visibility,
    DateTimeOffset Created,
    bool Search,
    IReadOnlyList<string> Branches);

public sealed record Entry(
    string Path,
    EntryKind Kind,
    long Size,
    DateTimeOffset? Modified,
    bool Executable,
    string? Target = null);

public sealed record Commit(string Id, string Message, DateTimeOffset Created, string? Merged);

public sealed record Committed(string Commit, bool Changed);

public sealed record DiffChange(string Path, ChangeKind Change);

public sealed record GrepMatch(string Path, int Line, string Text);

public sealed record FoundEntry(string Path, EntryKind Kind, long Size);

public sealed record FileHit(string Path, double Score, string Snippet);

public sealed record DiskMerged(string? Commit, IReadOnlyList<string> Conflicts);

internal sealed record DiskBranch(string Name, string? Head);

internal sealed record Uploaded(string Part, long Size);
