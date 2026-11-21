using Xunit;

namespace Skywake.Tests;

[TestCaseOrderer("Skywake.Tests.ByName", "Skywake.Tests")]
public sealed class ScenarioTests : IClassFixture<ScenarioFixture>
{
    private readonly ScenarioFixture _fixture;

    public ScenarioTests(ScenarioFixture fixture) => _fixture = fixture;

    private SkywakeClient Sky => _fixture.Sky;

    private DiskHandle App => Sky.Disk("app");

    [ScenarioFact]
    public async Task S01_WithOnlyTheKeySetWhoamiShowsTheEnvironment()
    {
        var me = await Sky.WhoamiAsync();
        Assert.Equal("prod", me.Environment);
        Assert.Equal(Role.Admin, me.Role);
    }

    [ScenarioFact]
    public async Task S02_AFileWrittenToANewDiskReadsBackAndIsListed()
    {
        await Sky.CreateDiskAsync("app", new NewDiskOptions { Search = true });
        await App.WriteAsync("README.md", "# App\n");
        Assert.Equal("# App\n", await App.ReadAsync("README.md"));
        var listed = await App.ListAsync();
        Assert.Equal(new[] { ("README.md", EntryKind.File) }, listed.Select(entry => (entry.Path, entry.Kind)));
    }

    [ScenarioFact]
    public async Task S03_ManyFilesWrittenTogetherAreOneCommit()
    {
        var before = (await App.LogAsync().ToListAsync()).Count;
        await App.WriteAsync(
            new Dictionary<string, string>
            {
                ["src/a.ts"] = "export const a = 1;\n",
                ["src/b.ts"] = "export const b = 2;\n",
                ["notes.txt"] = "hi",
            },
            new WriteOptions { Message = "three files" });
        var log = await App.LogAsync().ToListAsync();
        Assert.Equal(before + 1, log.Count);
        Assert.Equal("three files", log[0].Message);
    }

    [ScenarioFact]
    public async Task S04_BothSidesChangingOneFileMakeTheMergeAMergeConflict()
    {
        var work = await App.ForkAsync("agent-1");
        await work.WriteAsync("notes.txt", "from the agent");
        await App.WriteAsync("notes.txt", "from main");
        var error = await Assert.ThrowsAsync<MergeConflictException>(() => work.MergeIntoAsync("main"));
        Assert.Equal(new[] { "notes.txt" }, error.Conflicts);
        var settled = await work.MergeIntoAsync("main", new MergeOptions { Prefer = Prefer.Theirs });
        Assert.NotNull(settled.Commit);
        Assert.Equal("from the agent", await App.ReadAsync("notes.txt"));
    }

    [ScenarioFact]
    public async Task S05_GrepFindAndQueryOnADiskFindAFile()
    {
        await App.WriteAsync("docs/coffee.md", "How to brew coffee at home.\n");
        var lines = await App.GrepAsync("brew");
        Assert.Equal(new[] { ("docs/coffee.md", 1) }, lines.Select(line => (line.Path, line.Line)));
        var found = await App.FindAsync("*.md", new FindOptions { Path = "docs" });
        Assert.Equal(new[] { "docs/coffee.md" }, found.Select(entry => entry.Path));
        var hits = await Eventually(async () =>
        {
            var hits = await App.QueryAsync("coffee");
            return hits.Any(hit => hit.Path == "docs/coffee.md") ? hits : null;
        });
        Assert.Equal("docs/coffee.md", hits?[0].Path);
    }

    [ScenarioFact]
    public async Task S06_ReadWithAtReturnsTheOldContentAfterAChange()
    {
        var old = await App.HeadAsync();
        await App.WriteAsync("README.md", "# App, changed\n");
        Assert.Equal("# App\n", await App.ReadAsync("README.md", new ReadOptions { At = old }));
        Assert.Equal("# App, changed\n", await App.ReadAsync("README.md"));
    }

    [ScenarioFact]
    public async Task S07_KeysStayInTheirEnvironmentAndTheirRole()
    {
        using var staging = new SkywakeClient(new SkywakeOptions { Key = _fixture.StagingKey, Environment = "prod" });
        await Assert.ThrowsAsync<PermissionException>(() => staging.Disk("app").ReadAsync("README.md"));
        using var reader = new SkywakeClient(new SkywakeOptions { Key = _fixture.ReadKey });
        Assert.Equal("# App, changed\n", await reader.Disk("app").ReadAsync("README.md"));
        await Assert.ThrowsAsync<PermissionException>(() => reader.Disk("app").WriteAsync("x.txt", "nope"));
    }

    [ScenarioFact]
    public async Task S08_AWrongNameIsNotFoundWithASuggestion()
    {
        var disk = await Assert.ThrowsAsync<NotFoundException>(() => Sky.Disk("ap").ReadAsync("README.md"));
        Assert.Contains("`app`", disk.Hint ?? "");
    }

    [ScenarioFact]
    public async Task S09_DestroyingABranchThenTheDiskEmptiesTheList()
    {
        await App.On("agent-1").DestroyAsync();
        Assert.Equal(new[] { "main" }, (await App.BranchesAsync()).Select(branch => branch.Name));
        await App.DestroyAsync();
        Assert.Empty(await Sky.ListDisksAsync().ToListAsync());
    }

    [ScenarioFact]
    public async Task S10_AFolderGoesUpAsOneCommitAndComesBackTheSame()
    {
        var dir = Directory.CreateTempSubdirectory("skywake-up-").FullName;
        File.WriteAllText(Path.Combine(dir, "a.txt"), "alpha");
        File.WriteAllBytes(Path.Combine(dir, "b.bin"), new byte[] { 0, 1, 2, 255 });
        var site = Sky.Disk("site");
        await site.UploadAsync(dir, "site");
        var back = Directory.CreateTempSubdirectory("skywake-down-").FullName;
        await site.DownloadAsync(back);
        Assert.Equal("alpha", File.ReadAllText(Path.Combine(back, "a.txt")));
        Assert.Equal(new byte[] { 0, 1, 2, 255 }, File.ReadAllBytes(Path.Combine(back, "b.bin")));
        await site.DestroyAsync();
    }

    private static async Task<T?> Eventually<T>(Func<Task<T?>> check)
        where T : class
    {
        for (var tries = 0; ; tries++)
        {
            var found = await check();
            if (found is not null || tries == 100)
            {
                return found;
            }
            await Task.Delay(200);
        }
    }
}
