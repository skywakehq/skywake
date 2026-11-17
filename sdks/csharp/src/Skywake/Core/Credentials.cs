using System.Text.Json;
using System.Text.RegularExpressions;

namespace Skywake;

internal static class Credentials
{
    private static readonly Regex Table = new(@"^\[\s*([^\]]+?)\s*\]$");
    private static readonly Regex Pair = new(@"^([A-Za-z_]+)\s*=\s*""((?:[^""\\]|\\.)*)""$");
    private static readonly HashSet<string> Fields = new() { "key", "url", "environment" };

    internal static string? FilePath()
    {
        if (OperatingSystem.IsWindows() && Settings.Env("APPDATA") is { } appData)
        {
            return System.IO.Path.Combine(appData, "skywake", "credentials.toml");
        }
        var home = Settings.Env("HOME") ?? System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile);
        var config = Settings.Env("XDG_CONFIG_HOME") ?? System.IO.Path.Combine(home, ".config");
        return System.IO.Path.Combine(config, "skywake", "credentials.toml");
    }

    internal static IReadOnlyDictionary<string, string> Profile(string name)
    {
        var path = FilePath();
        try
        {
            return path is not null && Parse(File.ReadAllText(path)).TryGetValue(name, out var profile)
                ? profile
                : new Dictionary<string, string>();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return new Dictionary<string, string>();
        }
    }

    internal static Dictionary<string, Dictionary<string, string>> Parse(string text)
    {
        var profiles = new Dictionary<string, Dictionary<string, string>>();
        Dictionary<string, string>? current = null;
        foreach (var raw in text.Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#'))
            {
                continue;
            }
            if (Table.Match(line) is { Success: true } table)
            {
                var name = table.Groups[1].Value;
                current = profiles.TryGetValue(name, out var found) ? found : profiles[name] = new Dictionary<string, string>();
                continue;
            }
            if (Pair.Match(line) is { Success: true } pair && current is not null && Fields.Contains(pair.Groups[1].Value))
            {
                current[pair.Groups[1].Value] = JsonSerializer.Deserialize<string>($"\"{pair.Groups[2].Value}\"")!;
            }
        }
        return profiles;
    }
}
