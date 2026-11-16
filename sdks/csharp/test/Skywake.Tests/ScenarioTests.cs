using System.Text.Json.Nodes;
using Xunit;

namespace Skywake.Tests;

[TestCaseOrderer("Skywake.Tests.ByName", "Skywake.Tests")]
public sealed class ScenarioTests : IClassFixture<ScenarioFixture>
{
    private readonly ScenarioFixture _fixture;

    public ScenarioTests(ScenarioFixture fixture) => _fixture = fixture;

    private SkywakeClient Sky => _fixture.Sky;

    private IndexHandle Products => Sky.Index("products");

    private DiskHandle App => Sky.Disk("app");

    [ScenarioFact]
    public async Task S01_WithOnlyTheKeySetWhoamiShowsTheEnvironment()
    {
        var me = await Sky.WhoamiAsync();
        Assert.Equal("prod", me.Environment);
        Assert.Equal(Role.Admin, me.Role);
    }

    [ScenarioFact]
    public async Task S02_OneRowUpsertedToANewIndexWithNoSchemaIsFoundByQuery()
    {
        await Products.UpsertAsync(new { id = "mug", text = "a blue coffee mug", price = 12, tags = new[] { "kitchen" } });
        var hits = await Products.QueryAsync("coffee mug");
        Assert.Equal("mug", (string?)hits[0]["id"]);
        Assert.Equal(12, (double)hits[0]["price"]!);
        Assert.True((double)hits[0]["score"]! > 0);
    }

    [ScenarioFact]
    public async Task S03_TenThousandRowsUpsertedInOneCallAreAllCounted()
    {
        var rows = Enumerable.Range(0, 10_000).Select(i => new
        {
            id = $"row-{i}",
            text = i % 2 == 1 ? $"running shoe number {i}" : $"invoice {i}",
            price = i % 100,
            tags = new[] { i % 2 == 1 ? "shoes" : "billing" },
        });
        var bulk = Sky.Index("bulk");
        Assert.Equal(10_000, (await bulk.UpsertAsync(rows)).Count);
        Assert.Equal(10_000, await bulk.CountAsync());
        Assert.Equal(5_000, await bulk.CountAsync(new { tags = new { contains = "shoes" } }));
    }

    [ScenarioFact]
    public async Task S04_AQueryTakesAFilterALimitAndKeywordsMode()
    {
        var hits = await Sky.Index("bulk").QueryAsync("shoe", new QueryOptions
        {
            Mode = QueryMode.Keywords,
            Filter = new { price = new { lt = 10 } },
            Limit = 3,
        });
        Assert.Equal(3, hits.Count);
        foreach (var hit in hits)
        {
            Assert.True((double)hit["price"]! < 10);
            Assert.Contains("shoe", (string?)hit["text"]);
        }
    }

    [ScenarioFact]
    public async Task S05_UpdateShowsInGetAndDeleteMakesGetNull()
    {
        Assert.Equal(1, await Products.UpdateAsync("mug", new { price = 9 }));
        Assert.Equal(9, (double)(await Products.GetAsync("mug"))!["price"]!);
        Assert.Equal(1, await Products.DeleteAsync("mug"));
        Assert.Null(await Products.GetAsync("mug"));
    }

    [ScenarioFact]
    public async Task S06_AForkChangesApartFromMainAndMergingBringsTheChange()
    {
        await Products.UpsertAsync(new { id = "cup", text = "a white coffee cup", price = 5 });
        var draft = await Products.ForkAsync("draft");
        await draft.UpdateAsync("cup", new { price = 7 });
        Assert.Equal(7, Price(await draft.QueryAsync("coffee cup")));
        Assert.Equal(5, Price(await Products.QueryAsync("coffee cup")));
        await draft.MergeIntoAsync("main");
        Assert.Equal(7, (double)(await Products.GetAsync("cup"))!["price"]!);
    }

    [ScenarioFact]
    public async Task S07_AFileWrittenToANewDiskReadsBackAndIsListed()
    {
        await App.WriteAsync("README.md", "# App\n");
        Assert.Equal("# App\n", await App.ReadAsync("README.md"));
        var listed = await App.ListAsync();
        Assert.Equal(new[] { ("README.md", EntryKind.File) }, listed.Select(entry => (entry.Path, entry.Kind)));
    }

    [ScenarioFact]
    public async Task S08_ManyFilesWrittenTogetherAreOneCommit()
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
    public async Task S09_BothSidesChangingOneFileMakeTheMergeAMergeConflict()
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
    public async Task S10_GrepFindAndQueryOnADiskFindAFile()
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
    public async Task S11_ReadWithAtReturnsTheOldContentAfterAChange()
    {
        var old = await App.HeadAsync();
        await App.WriteAsync("README.md", "# App, changed\n");
        Assert.Equal("# App\n", await App.ReadAsync("README.md", new ReadOptions { At = old }));
        Assert.Equal("# App, changed\n", await App.ReadAsync("README.md"));
    }

    [ScenarioFact]
    public async Task S12_KeysStayInTheirEnvironmentAndTheirRole()
    {
        using var staging = new SkywakeClient(new SkywakeOptions { Key = _fixture.StagingKey, Environment = "prod" });
        await Assert.ThrowsAsync<PermissionException>(() => staging.Index("products").QueryAsync("coffee"));
        using var reader = new SkywakeClient(new SkywakeOptions { Key = _fixture.ReadKey });
        Assert.Equal(7, (double)(await reader.Index("products").GetAsync("cup"))!["price"]!);
        await Assert.ThrowsAsync<PermissionException>(() => reader.Index("products").UpsertAsync(new { id = "x", text = "nope" }));
    }

    [ScenarioFact]
    public async Task S13_AWrongNameIsNotFoundWithASuggestion()
    {
        var index = await Assert.ThrowsAsync<NotFoundException>(() => Sky.Index("prodcts").QueryAsync("coffee"));
        Assert.Contains("products", index.Hint ?? "");
        var disk = await Assert.ThrowsAsync<NotFoundException>(() => Sky.Disk("ap").ReadAsync("README.md"));
        Assert.Contains("`app`", disk.Hint ?? "");
    }

    [ScenarioFact]
    public async Task S14_DestroyingABranchThenTheIndexAndTheDiskEmptiesTheLists()
    {
        await Products.On("draft").DestroyAsync();
        Assert.Equal(new[] { "main" }, (await Products.BranchesAsync()).Select(branch => branch.Name));
        await App.On("agent-1").DestroyAsync();
        foreach (var name in new[] { "products", "bulk" })
        {
            await Sky.Index(name).DestroyAsync();
        }
        await App.DestroyAsync();
        Assert.Empty(await Sky.ListIndexesAsync().ToListAsync());
        Assert.Empty(await Sky.ListDisksAsync().ToListAsync());
    }

    [ScenarioFact]
    public async Task S15_AFolderGoesUpAsOneCommitAndComesBackTheSame()
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

    private static double Price(IReadOnlyList<JsonObject> hits) => (double)hits[0]["price"]!;

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
