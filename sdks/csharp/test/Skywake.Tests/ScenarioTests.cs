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
    public async Task S07_KeysStayInTheirEnvironmentAndTheirRole()
    {
        using var staging = new SkywakeClient(new SkywakeOptions { Key = _fixture.StagingKey, Environment = "prod" });
        await Assert.ThrowsAsync<PermissionException>(() => staging.Index("products").QueryAsync("coffee"));
        using var reader = new SkywakeClient(new SkywakeOptions { Key = _fixture.ReadKey });
        Assert.Equal(7, (double)(await reader.Index("products").GetAsync("cup"))!["price"]!);
        await Assert.ThrowsAsync<PermissionException>(() => reader.Index("products").UpsertAsync(new { id = "x", text = "nope" }));
    }

    [ScenarioFact]
    public async Task S08_AWrongNameIsNotFoundWithASuggestion()
    {
        var index = await Assert.ThrowsAsync<NotFoundException>(() => Sky.Index("prodcts").QueryAsync("coffee"));
        Assert.Contains("products", index.Hint ?? "");
    }

    [ScenarioFact]
    public async Task S09_DestroyingABranchThenTheIndexesEmptiesTheList()
    {
        await Products.On("draft").DestroyAsync();
        Assert.Equal(new[] { "main" }, (await Products.BranchesAsync()).Select(branch => branch.Name));
        foreach (var name in new[] { "products", "bulk" })
        {
            await Sky.Index(name).DestroyAsync();
        }
        Assert.Empty(await Sky.ListIndexesAsync().ToListAsync());
    }

    private static double Price(IReadOnlyList<JsonObject> hits) => (double)hits[0]["price"]!;
}
