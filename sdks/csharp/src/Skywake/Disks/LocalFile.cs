namespace Skywake;

internal sealed record LocalFile(string Path, string FullPath, long Size, bool Executable)
{
    internal static List<LocalFile> All(string root)
    {
        var found = new List<LocalFile>();
        Visit(new DirectoryInfo(root), "", found);
        found.Sort((a, b) => string.CompareOrdinal(a.Path, b.Path));
        return found;
    }

    private static void Visit(DirectoryInfo folder, string prefix, List<LocalFile> found)
    {
        foreach (var entry in folder.EnumerateFileSystemInfos())
        {
            if (entry.Name == ".git" || entry.LinkTarget is not null)
            {
                continue;
            }
            var name = prefix + entry.Name;
            if (entry is DirectoryInfo inner)
            {
                Visit(inner, name + "/", found);
            }
            else if (entry is FileInfo file)
            {
                found.Add(new LocalFile(name, file.FullName, file.Length, Folders.IsExecutable(file)));
            }
        }
    }
}
