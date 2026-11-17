using System.Text.Json.Nodes;

namespace Skywake;

internal static class Folders
{
    private const UnixFileMode Executable = UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute;

    private const UnixFileMode RunnableMode = UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
        | UnixFileMode.GroupRead | UnixFileMode.GroupExecute | UnixFileMode.OtherRead | UnixFileMode.OtherExecute;

    internal static async Task<string?> DownloadAsync(DiskHandle disk, string dir, string? at, CancellationToken ct)
    {
        at ??= await disk.HeadAsync(ct).ConfigureAwait(false);
        var root = Path.GetFullPath(dir);
        Directory.CreateDirectory(root);
        if (at is null)
        {
            return null;
        }
        var entries = await disk.WalkAsync("", at, ct).CollectAsync(ct).ConfigureAwait(false);
        foreach (var entry in entries.Where(entry => entry.Kind == EntryKind.Folder))
        {
            Directory.CreateDirectory(Local(root, entry.Path));
        }
        var files = entries.Where(entry => entry.Kind != EntryKind.Folder).ToList();
        await Concurrent.RunAsync(files, (entry, token) => SaveAsync(disk, root, entry, at, token), ct).ConfigureAwait(false);
        return at;
    }

    internal static async Task<string?> UploadAsync(DiskHandle disk, string dir, string? message, CancellationToken ct)
    {
        var files = LocalFile.All(Path.GetFullPath(dir));
        string? head = null;
        foreach (var batch in Batches.Split(files, Changes.CommitCount, Changes.CommitBytes, file => Changes.Weight(file.Path, file.Size)))
        {
            var changes = await Concurrent.MapAsync(batch, (file, token) => ChangeFromAsync(disk, file, token), ct).ConfigureAwait(false);
            head = (await disk.CommitAsync(changes, message, ct).ConfigureAwait(false)).Commit;
        }
        return head ?? await disk.HeadAsync(ct).ConfigureAwait(false);
    }

    private static async Task SaveAsync(DiskHandle disk, string root, Entry entry, string at, CancellationToken ct)
    {
        var file = Local(root, entry.Path);
        if (entry.Kind == EntryKind.Symlink)
        {
            File.Delete(file);
            File.CreateSymbolicLink(file, entry.Target ?? "");
            return;
        }
        await using (var source = await disk.OpenReadAsync(entry.Path, new ReadOptions { At = at }, ct).ConfigureAwait(false))
        await using (var target = File.Create(file))
        {
            await source.CopyToAsync(target, ct).ConfigureAwait(false);
        }
        if (entry.Executable && !OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(file, RunnableMode);
        }
    }

    private static string Local(string root, string name)
    {
        var file = Path.GetFullPath(Path.Combine(new[] { root }.Concat(name.Split('/')).ToArray()));
        if (!file.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"`{name}` is outside {root}");
        }
        return file;
    }

    private static async Task<JsonObject> ChangeFromAsync(DiskHandle disk, LocalFile file, CancellationToken ct)
    {
        if (file.Size <= Changes.InlineMax)
        {
            var bytes = await File.ReadAllBytesAsync(file.FullPath, ct).ConfigureAwait(false);
            return await Changes.OfAsync(file.Path, bytes, disk.PartAsync, file.Executable, ct).ConfigureAwait(false);
        }
        var parts = new List<string>();
        await using var stream = File.OpenRead(file.FullPath);
        for (long offset = 0; offset < file.Size; offset += Changes.PartMax)
        {
            var bytes = new byte[Math.Min(Changes.PartMax, file.Size - offset)];
            await stream.ReadExactlyAsync(bytes, ct).ConfigureAwait(false);
            parts.Add(await disk.PartAsync(bytes, ct).ConfigureAwait(false));
        }
        return Changes.With(file.Path, "parts", parts, file.Executable);
    }

    internal static bool IsExecutable(FileInfo info) =>
        !OperatingSystem.IsWindows() && (info.UnixFileMode & Executable) != 0;
}
