using Xunit;

namespace Skywake.Tests;

public sealed class ScenarioFactAttribute : FactAttribute
{
    public ScenarioFactAttribute()
    {
        if (ScenarioFixture.Url is null || ScenarioFixture.AdminKey is null)
        {
            Skip = "needs SKYWAKE_SCENARIO_URL and SKYWAKE_SCENARIO_KEY";
        }
    }
}

public sealed class ScenarioFixture : IAsyncLifetime
{
    public static readonly string? Url = Environment.GetEnvironmentVariable("SKYWAKE_SCENARIO_URL");
    public static readonly string? AdminKey = Environment.GetEnvironmentVariable("SKYWAKE_SCENARIO_KEY");

    public SkywakeClient Sky { get; private set; } = null!;

    public string StagingKey { get; private set; } = "";

    public string ReadKey { get; private set; } = "";

    public async Task InitializeAsync()
    {
        if (Url is null || AdminKey is null)
        {
            return;
        }
        using var org = new SkywakeClient(new SkywakeOptions { Url = Url, Key = AdminKey });
        foreach (var name in new[] { "prod", "staging" })
        {
            try
            {
                await org.CreateEnvironmentAsync(name);
            }
            catch (ConflictException)
            {
            }
        }
        var prod = await org.CreateKeyAsync(new NewKey("prod", Role.Admin) { Environment = "prod" });
        StagingKey = (await org.CreateKeyAsync(new NewKey("staging", Role.Admin) { Environment = "staging" })).Key;
        ReadKey = (await org.CreateKeyAsync(new NewKey("reader", Role.Read) { Environment = "prod" })).Key;
        foreach (var name in new[] { "SKYWAKE_KEY", "SKYWAKE_ENV", "SKYWAKE_PROFILE" })
        {
            Environment.SetEnvironmentVariable(name, null);
        }
        Environment.SetEnvironmentVariable("SKYWAKE_URL", Url);
        Environment.SetEnvironmentVariable("SKYWAKE_API_KEY", prod.Key);
        Sky = new SkywakeClient();
    }

    public Task DisposeAsync()
    {
        Sky?.Dispose();
        return Task.CompletedTask;
    }
}
