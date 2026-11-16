using Xunit;

namespace Skywake.Tests;

public sealed class SettingsTests : IDisposable
{
    private static readonly string[] Names =
        { "SKYWAKE_API_KEY", "SKYWAKE_KEY", "SKYWAKE_URL", "SKYWAKE_ENV", "SKYWAKE_PROFILE", "XDG_CONFIG_HOME" };

    private readonly Dictionary<string, string?> _saved = Names.ToDictionary(name => name, Environment.GetEnvironmentVariable);
    private readonly string _config = Directory.CreateTempSubdirectory("skywake-config-").FullName;

    public SettingsTests()
    {
        foreach (var name in Names)
        {
            Environment.SetEnvironmentVariable(name, null);
        }
        Environment.SetEnvironmentVariable("XDG_CONFIG_HOME", _config);
    }

    public void Dispose()
    {
        foreach (var (name, value) in _saved)
        {
            Environment.SetEnvironmentVariable(name, value);
        }
        Directory.Delete(_config, true);
    }

    [Fact]
    public void WithNothingSetTheErrorSaysHowToSignIn()
    {
        var error = Assert.Throws<InvalidOperationException>(() => new SkywakeClient());
        Assert.Contains("skywake login", error.Message);
        Assert.Contains("SKYWAKE_API_KEY", error.Message);
    }

    [Fact]
    public async Task TheKeyComesFromTheEnvironmentAndTheUrlDefaultsToTheCloud()
    {
        Environment.SetEnvironmentVariable("SKYWAKE_API_KEY", "sw_env");
        var api = Recorder();
        await new SkywakeClient(new SkywakeOptions { Handler = api }).WhoamiAsync();
        Assert.Equal("Bearer sw_env", api.Seen[0].Headers["authorization"]);
        Assert.Equal("https://api.skywake.dev", new SkywakeClient().Url);
        Assert.False(api.Seen[0].Headers.ContainsKey("skywake-environment"));
    }

    [Fact]
    public async Task AProfileIsUsedWhenNoKeyIsGiven()
    {
        Directory.CreateDirectory(Path.Combine(_config, "skywake"));
        File.WriteAllText(
            Path.Combine(_config, "skywake", "credentials.toml"),
            "[default]\nkey = \"sw_file\"\nurl = \"http://local/v2/\"\nenvironment = \"prod\"\n\n[staging]\nkey = \"sw_staging\"\n");
        var api = Recorder();
        var sky = new SkywakeClient(new SkywakeOptions { Handler = api });
        await sky.WhoamiAsync();
        Assert.Equal("http://local", sky.Url);
        Assert.Equal("Bearer sw_file", api.Seen[0].Headers["authorization"]);
        Assert.Equal("prod", api.Seen[0].Headers["skywake-environment"]);
        Environment.SetEnvironmentVariable("SKYWAKE_PROFILE", "staging");
        await new SkywakeClient(new SkywakeOptions { Handler = api }).WhoamiAsync();
        Assert.Equal("Bearer sw_staging", api.Seen[1].Headers["authorization"]);
    }

    [Fact]
    public void CodeWinsOverTheEnvironment()
    {
        Environment.SetEnvironmentVariable("SKYWAKE_API_KEY", "sw_env");
        Environment.SetEnvironmentVariable("SKYWAKE_URL", "http://env");
        Environment.SetEnvironmentVariable("SKYWAKE_ENV", "staging");
        var sky = new SkywakeClient(new SkywakeOptions { Url = "http://code", Environment = "prod" });
        Assert.Equal(("http://code", "prod"), (sky.Url, sky.Environment));
        Assert.Equal(("http://env", "staging"), (new SkywakeClient().Url, new SkywakeClient().Environment));
    }

    private static FakeApi Recorder() => new((_, _) => new Reply(Body: new { organization = "o", role = "admin" }));
}
