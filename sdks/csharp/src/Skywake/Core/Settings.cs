namespace Skywake;

internal sealed record Settings(string Key, string Url, string? Environment)
{
    internal const string DefaultUrl = "https://api.skywake.dev";

    internal static string? Env(string name) =>
        System.Environment.GetEnvironmentVariable(name) is { Length: > 0 } value ? value : null;

    internal static Settings Resolve(SkywakeOptions asked)
    {
        var given = asked.Key ?? Env("SKYWAKE_API_KEY") ?? Env("SKYWAKE_KEY");
        var profile = given is null
            ? Credentials.Profile(asked.Profile ?? Env("SKYWAKE_PROFILE") ?? "default")
            : new Dictionary<string, string>();
        var key = given ?? profile.GetValueOrDefault("key")
            ?? throw new InvalidOperationException(
                "no Skywake API key: run `skywake login`, set SKYWAKE_API_KEY, or pass Key in SkywakeOptions");
        return new Settings(
            key,
            asked.Url ?? Env("SKYWAKE_URL") ?? profile.GetValueOrDefault("url") ?? DefaultUrl,
            asked.Environment ?? Env("SKYWAKE_ENV") ?? profile.GetValueOrDefault("environment"));
    }
}
