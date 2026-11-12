// One example per SDK operation per language. `scripts/check-sdk-examples.ts`
// checks that each one calls only what its SDK defines.

export const languages = ["typescript", "python", "go", "ruby", "rust", "java", "csharp"] as const;
export type Language = (typeof languages)[number];
export const labels: Record<Language, string> = {
  typescript: "TypeScript",
  python: "Python",
  go: "Go",
  ruby: "Ruby",
  rust: "Rust",
  java: "Java",
  csharp: "C#",
};

export interface SdkOperation {
  slug: string;
  title: string;
  description: string;
  examples: Partial<Record<Language, string>>;
}

export const operations: SdkOperation[] = [
  {
    slug: "connect",
    title: "Connect",
    description: "Make a client with the API's URL and an API key.",
    examples: {
      typescript: `import { Skywake } from "@skywake/sdk";

const sky = new Skywake({
  url: process.env.SKYWAKE_URL!,
  key: process.env.SKYWAKE_KEY!,
});`,
      python: `import os

from skywake import Skywake

sky = Skywake(os.environ["SKYWAKE_URL"], os.environ["SKYWAKE_KEY"])`,
      go: `import (
	"context"
	"os"

	skywake "github.com/skywakehq/skywake/sdks/go"
)

sky := skywake.New(os.Getenv("SKYWAKE_URL"), os.Getenv("SKYWAKE_KEY"))
ctx := context.Background()`,
      ruby: `require "skywake"

sky = Skywake::Client.new(ENV["SKYWAKE_URL"], ENV["SKYWAKE_KEY"])`,
      rust: `use std::env;
use skywake::Client;

let sky = Client::new(&env::var("SKYWAKE_URL")?, &env::var("SKYWAKE_KEY")?)?;`,
      java: `import dev.skywake.Skywake;

var sky = new Skywake(System.getenv("SKYWAKE_URL"), System.getenv("SKYWAKE_KEY"));`,
      csharp: `using Skywake;

using var sky = new SkywakeClient(
    Environment.GetEnvironmentVariable("SKYWAKE_URL")!,
    Environment.GetEnvironmentVariable("SKYWAKE_KEY")!);`,
    },
  },
  {
    slug: "create-index",
    title: "Create an index",
    description:
      "Make an index with a vector column and two attributes. Needs an admin key. The part of the name before the first slash is the environment; products has none, so it goes in default.",
    examples: {
      typescript: `const products = await sky.indexes.create("products", {
  vectors: [{ name: "embedding", dims: 3 }],
  attributes: [
    { name: "title", type: "text" },
    { name: "price", type: "number" },
  ],
});`,
      python: `products = sky.indexes.create(
    "products",
    vectors=[{"name": "embedding", "dims": 3}],
    attributes=[{"name": "title", "type": "text"}, {"name": "price", "type": "number"}],
)`,
      go: `products, err := sky.Indexes.Create(ctx, skywake.NewIndex{
	Name: "products",
	Schema: skywake.Schema{
		Vectors:    []skywake.VectorColumn{{Name: "embedding", Dims: 3}},
		Attributes: []skywake.Attribute{{Name: "title", Type: "text"}, {Name: "price", Type: "number"}},
	},
})`,
      ruby: `products = sky.indexes.create("products",
  vectors: [{ name: "embedding", dims: 3 }],
  attributes: [{ name: "title", type: "text" }, { name: "price", type: "number" }])`,
      rust: `use serde_json::json;
use skywake::IndexOptions;

let schema = json!({
    "vectors": [{ "name": "embedding", "dims": 3 }],
    "attributes": [
        { "name": "title", "type": "text" },
        { "name": "price", "type": "number" },
    ],
});
let products = sky.indexes().create("products", schema, &IndexOptions::default()).await?;`,
      java: `SearchIndex products = sky.indexes().create(new NewIndex("products", new Schema(
        List.of(new VectorColumn("embedding", 3)),
        List.of(new Attribute("title", "text"), new Attribute("price", "number")))));`,
      csharp: `var products = await sky.Indexes.CreateAsync(new NewIndex("products", new Schema(
    new[] { new VectorColumn("embedding", 3) },
    new[] { new AttributeColumn("title", "text"), new AttributeColumn("price", "number") })));`,
    },
  },
  {
    slug: "upsert",
    title: "Upsert documents",
    description: "Write documents. Each replaces any earlier one with its id.",
    examples: {
      typescript: `const count = await sky.index("products").upsert([
  { id: 1, vectors: { embedding: [0.1, 0.2, 0.3] }, attributes: { title: "Desk lamp", price: 40 } },
  { id: 2, vectors: { embedding: [0.3, 0.1, 0.2] }, attributes: { title: "Red mug", price: 9 } },
]);`,
      python: `count = sky.index("products").upsert([
    {"id": 1, "vectors": {"embedding": [0.1, 0.2, 0.3]}, "attributes": {"title": "Desk lamp", "price": 40}},
    {"id": 2, "vectors": {"embedding": [0.3, 0.1, 0.2]}, "attributes": {"title": "Red mug", "price": 9}},
])`,
      go: `count, err := sky.Index("products").Upsert(ctx, []skywake.Document{
	{
		ID:         1,
		Vectors:    map[string]any{"embedding": []float32{0.1, 0.2, 0.3}},
		Attributes: map[string]any{"title": "Desk lamp", "price": 40},
	},
	{
		ID:         2,
		Vectors:    map[string]any{"embedding": []float32{0.3, 0.1, 0.2}},
		Attributes: map[string]any{"title": "Red mug", "price": 9},
	},
})`,
      ruby: `count = sky.index("products").upsert([
  { id: 1, vectors: { embedding: [0.1, 0.2, 0.3] }, attributes: { title: "Desk lamp", price: 40 } },
  { id: 2, vectors: { embedding: [0.3, 0.1, 0.2] }, attributes: { title: "Red mug", price: 9 } },
])`,
      rust: `use serde_json::json;
use skywake::Document;

let docs: Vec<Document> = serde_json::from_value(json!([
    { "id": 1, "vectors": { "embedding": [0.1, 0.2, 0.3] }, "attributes": { "title": "Desk lamp", "price": 40 } },
    { "id": 2, "vectors": { "embedding": [0.3, 0.1, 0.2] }, "attributes": { "title": "Red mug", "price": 9 } },
]))?;
let count = sky.index("products").upsert(&docs).await?;`,
      java: `int count = sky.index("products").upsert(List.of(
        new Document(1, Map.of("embedding", new float[] {0.1f, 0.2f, 0.3f}),
                Map.of("title", "Desk lamp", "price", 40)),
        new Document(2, Map.of("embedding", new float[] {0.3f, 0.1f, 0.2f}),
                Map.of("title", "Red mug", "price", 9))));`,
      csharp: `var count = await sky.Index("products").UpsertAsync(new[]
{
    new Document(1,
        new Dictionary<string, object?> { ["embedding"] = new[] { 0.1f, 0.2f, 0.3f } },
        new Dictionary<string, object?> { ["title"] = "Desk lamp", ["price"] = 40 }),
    new Document(2,
        new Dictionary<string, object?> { ["embedding"] = new[] { 0.3f, 0.1f, 0.2f } },
        new Dictionary<string, object?> { ["title"] = "Red mug", ["price"] = 9 }),
});`,
    },
  },
  {
    slug: "query",
    title: "Query by vector",
    description: "Find the documents nearest to a vector, nearest first.",
    examples: {
      typescript: `const hits = await sky.index("products").query({
  vector: { column: "embedding", value: [0.1, 0.2, 0.3] },
  topK: 5,
});
for (const hit of hits) console.log(hit.id, hit.distance);`,
      python: `hits = sky.index("products").query("embedding", [0.1, 0.2, 0.3], top_k=5)
for hit in hits:
    print(hit["id"], hit["distance"])`,
      go: `hits, err := sky.Index("products").Query(ctx, skywake.Query{
	Vector: skywake.Vector{Column: "embedding", Value: []float32{0.1, 0.2, 0.3}},
	TopK:   5,
})
if err != nil {
	return err
}
for _, hit := range hits.Items {
	fmt.Println(hit.ID, hit.Distance)
}`,
      ruby: `hits = sky.index("products").query("embedding", [0.1, 0.2, 0.3], top_k: 5)
hits.each { |hit| puts "#{hit["id"]} #{hit["distance"]}" }`,
      rust: `use skywake::Query;

let query = Query {
    top_k: Some(5),
    ..Query::new("embedding", [0.1, 0.2, 0.3])
};
for hit in sky.index("products").query(&query).await?.iter() {
    println!("{} {}", hit.id, hit.distance);
}`,
      java: `Results<Hit> hits = sky.index("products")
        .query(new Query("embedding", new float[] {0.1f, 0.2f, 0.3f}).topK(5));
for (Hit hit : hits) {
    System.out.println(hit.id() + " " + hit.distance());
}`,
      csharp: `var hits = await sky.Index("products").QueryAsync(
    new Query(new Vector("embedding", new[] { 0.1f, 0.2f, 0.3f })) { TopK = 5 });
foreach (var hit in hits)
{
    Console.WriteLine($"{hit.Id} {hit.Distance}");
}`,
    },
  },
  {
    slug: "search",
    title: "Full-text search",
    description: "Find the documents that best match words by BM25, best first.",
    examples: {
      typescript: `const hits = await sky.index("products").search({
  query: "desk lamp",
  fields: ["title"],
  topK: 5,
});
for (const hit of hits) console.log(hit.id, hit.score);`,
      python: `hits = sky.index("products").search("desk lamp", fields=["title"], top_k=5)
for hit in hits:
    print(hit["id"], hit["score"])`,
      go: `hits, err := sky.Index("products").Search(ctx, skywake.Search{
	Query:  "desk lamp",
	Fields: []string{"title"},
	TopK:   5,
})
if err != nil {
	return err
}
for _, hit := range hits.Items {
	fmt.Println(hit.ID, hit.Score)
}`,
      ruby: `hits = sky.index("products").search("desk lamp", fields: ["title"], top_k: 5)
hits.each { |hit| puts "#{hit["id"]} #{hit["score"]}" }`,
      rust: `use skywake::Search;

let search = Search {
    fields: Some(vec!["title".into()]),
    top_k: Some(5),
    ..Search::new("desk lamp")
};
for hit in sky.index("products").search(&search).await?.iter() {
    println!("{} {}", hit.id, hit.score);
}`,
      java: `Results<SearchHit> hits = sky.index("products")
        .search(new Search("desk lamp").fields(List.of("title")).topK(5));
for (SearchHit hit : hits) {
    System.out.println(hit.id() + " " + hit.score());
}`,
      csharp: `var hits = await sky.Index("products").SearchAsync(
    new Search("desk lamp") { Fields = new[] { "title" }, TopK = 5 });
foreach (var hit in hits)
{
    Console.WriteLine($"{hit.Id} {hit.Score}");
}`,
    },
  },
  {
    slug: "hybrid",
    title: "Hybrid search",
    description: "Run a vector query and a text search on one snapshot and fuse their ranks.",
    examples: {
      typescript: `const hits = await sky.index("products").hybrid({
  searches: {
    meaning: { vector: { column: "embedding", value: [0.1, 0.2, 0.3] }, topK: 50 },
    words: { query: "desk lamp", topK: 50 },
  },
  topK: 5,
});
for (const hit of hits) console.log(hit.id, hit.score);`,
      python: `hits = sky.index("products").hybrid(
    {
        "meaning": {"vector": {"column": "embedding", "value": [0.1, 0.2, 0.3]}, "topK": 50},
        "words": {"query": "desk lamp", "topK": 50},
    },
    top_k=5,
)`,
      go: `hits, err := sky.Index("products").Hybrid(ctx, skywake.Hybrid{
	Searches: map[string]any{
		"meaning": skywake.Query{
			Vector: skywake.Vector{Column: "embedding", Value: []float32{0.1, 0.2, 0.3}},
			TopK:   50,
		},
		"words": skywake.Search{Query: "desk lamp", TopK: 50},
	},
	TopK: 5,
})`,
      ruby: `hits = sky.index("products").hybrid({
  meaning: { vector: { column: "embedding", value: [0.1, 0.2, 0.3] }, topK: 50 },
  words: { query: "desk lamp", topK: 50 },
}, top_k: 5)`,
      rust: `use serde_json::{json, Map};
use skywake::Hybrid;

let mut searches = Map::new();
searches.insert("meaning".into(), json!({
    "vector": { "column": "embedding", "value": [0.1, 0.2, 0.3] },
    "topK": 50,
}));
searches.insert("words".into(), json!({ "query": "desk lamp", "topK": 50 }));
let hybrid = Hybrid { searches, top_k: Some(5), ..Default::default() };
let hits = sky.index("products").hybrid(&hybrid).await?;`,
      java: `Results<FusedHit> hits = sky.index("products").hybrid(new Hybrid(Map.of(
        "meaning", new Query("embedding", new float[] {0.1f, 0.2f, 0.3f}).topK(50),
        "words", new Search("desk lamp").topK(50)))
        .topK(5));`,
      csharp: `var hits = await sky.Index("products").HybridAsync(new Hybrid(new Dictionary<string, object>
{
    ["meaning"] = new Query(new Vector("embedding", new[] { 0.1f, 0.2f, 0.3f })) { TopK = 50 },
    ["words"] = new Search("desk lamp") { TopK = 50 },
}) { TopK = 5 });`,
    },
  },
  {
    slug: "filter",
    title: "Filter a query",
    description: "Keep only the hits whose attributes pass a filter.",
    examples: {
      typescript: `const hits = await sky.index("products").query({
  vector: { column: "embedding", value: [0.1, 0.2, 0.3] },
  topK: 5,
  filter: { and: [{ price: { gte: 20 } }, { price: { lt: 50 } }] },
});`,
      python: `hits = sky.index("products").query(
    "embedding",
    [0.1, 0.2, 0.3],
    top_k=5,
    filter={"and": [{"price": {"gte": 20}}, {"price": {"lt": 50}}]},
)`,
      go: `hits, err := sky.Index("products").Query(ctx, skywake.Query{
	Vector: skywake.Vector{Column: "embedding", Value: []float32{0.1, 0.2, 0.3}},
	TopK:   5,
	Filter: map[string]any{"and": []any{
		map[string]any{"price": map[string]any{"gte": 20}},
		map[string]any{"price": map[string]any{"lt": 50}},
	}},
})`,
      ruby: `hits = sky.index("products").query("embedding", [0.1, 0.2, 0.3],
  top_k: 5,
  filter: { and: [{ price: { gte: 20 } }, { price: { lt: 50 } }] })`,
      rust: `use serde_json::json;
use skywake::Query;

let query = Query {
    top_k: Some(5),
    filter: Some(json!({ "and": [{ "price": { "gte": 20 } }, { "price": { "lt": 50 } }] })),
    ..Query::new("embedding", [0.1, 0.2, 0.3])
};
let hits = sky.index("products").query(&query).await?;`,
      java: `Results<Hit> hits = sky.index("products").query(
        new Query("embedding", new float[] {0.1f, 0.2f, 0.3f})
                .topK(5)
                .filter(Map.of("and", List.of(
                        Map.of("price", Map.of("gte", 20)),
                        Map.of("price", Map.of("lt", 50))))));`,
      csharp: `var hits = await sky.Index("products").QueryAsync(
    new Query(new Vector("embedding", new[] { 0.1f, 0.2f, 0.3f }))
    {
        TopK = 5,
        Filter = new { and = new object[] { new { price = new { gte = 20 } }, new { price = new { lt = 50 } } } },
    });`,
    },
  },
  {
    slug: "fork",
    title: "Fork an index branch",
    description: "Fork a branch to change it in isolation. Nothing is copied.",
    examples: {
      typescript: `const trial = await sky.index("products").fork("agents/try");
await trial.deleteBy({ price: { gt: 100 } });`,
      python: `trial = sky.index("products").fork("agents/try")
trial.delete_by({"price": {"gt": 100}})`,
      go: `trial, err := sky.Index("products").Fork(ctx, "agents/try")
if err != nil {
	return err
}
_, err = trial.DeleteBy(ctx, map[string]any{"price": map[string]any{"gt": 100}})`,
      ruby: `trial = sky.index("products").fork("agents/try")
trial.delete_by(price: { gt: 100 })`,
      rust: `use serde_json::json;

let trial = sky.index("products").fork("agents/try").await?;
trial.delete_by(json!({ "price": { "gt": 100 } })).await?;`,
      java: `SearchIndex trial = sky.index("products").fork("agents/try");
trial.deleteBy(Map.of("price", Map.of("gt", 100)));`,
      csharp: `var trial = await sky.Index("products").ForkAsync("agents/try");
await trial.DeleteByAsync(new { price = new { gt = 100 } });`,
    },
  },
  {
    slug: "merge",
    title: "Merge an index branch",
    description: "Bring a branch's writes back into the branch it forked from.",
    examples: {
      typescript: `const products = sky.index("products");
const added = await products.merge("agents/try");
await products.at("agents/try").deleteBranch();`,
      python: `products = sky.index("products")
added = products.merge("agents/try")
products.at("agents/try").delete_branch()`,
      go: `products := sky.Index("products")
added, err := products.Merge(ctx, "agents/try")
if err != nil {
	return err
}
err = products.At("agents/try").DeleteBranch(ctx)`,
      ruby: `products = sky.index("products")
added = products.merge("agents/try")
products.at("agents/try").delete_branch`,
      rust: `let products = sky.index("products");
let added = products.merge("agents/try").await?;
products.at("agents/try").delete_branch().await?;`,
      java: `SearchIndex products = sky.index("products");
int added = products.merge("agents/try");
products.at("agents/try").deleteBranch();`,
      csharp: `var products = sky.Index("products");
var added = await products.MergeAsync("agents/try");
await products.At("agents/try").DeleteBranchAsync();`,
    },
  },
  {
    slug: "fork-filesystem",
    title: "Fork a filesystem branch",
    description: "Fork a branch of a namespace. No data is copied.",
    examples: {
      typescript: `const main = sky.namespace("acme").branch("main");
const fork = await main.fork("agents/42");
console.log(fork.name);`,
      python: `main = sky.namespace("acme").branch("main")
fork = main.fork("agents/42")
print(fork.name)`,
    },
  },
  {
    slug: "commit-files",
    title: "Commit files",
    description: "Write, change or remove files on a branch as one commit.",
    examples: {
      typescript: `const branch = sky.namespace("acme").branch("agents/42");
const head = await branch.write({ "notes.md": "hello", "todo.md": "ship docs" }, "add notes");
await branch.commit("drop the todo", [{ path: "todo.md", delete: true }]);`,
      python: `branch = sky.namespace("acme").branch("agents/42")
head = branch.write({"notes.md": "hello", "todo.md": "ship docs"}, "add notes")
branch.commit("drop the todo", [{"path": "todo.md", "delete": True}])`,
    },
  },
  {
    slug: "read-file",
    title: "Read a file",
    description: "Read a file from a branch, whole or a range of its bytes.",
    examples: {
      typescript: `const branch = sky.namespace("acme").branch("agents/42");
const text = await branch.readText("notes.md");
const bytes = await branch.read("notes.md", { offset: 0, length: 5 });`,
      python: `branch = sky.namespace("acme").branch("agents/42")
text = branch.read_text("notes.md")
data = branch.read("notes.md", offset=0, length=5)`,
    },
  },
];
