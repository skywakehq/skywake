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
      typescript: `import { Skywake } from "skywake";

const sky = new Skywake({ key: process.env.SKYWAKE_API_KEY! });`,
      python: `from skywake import Skywake

sky = Skywake()`,
      go: `import (
	"context"

	skywake "github.com/skywakehq/skywake/sdks/go"
)

sky, err := skywake.New()
ctx := context.Background()`,
      ruby: `require "skywake"

sky = Skywake.new`,
      rust: `use skywake::Skywake;

let sky = Skywake::new()?;`,
      java: `import dev.skywake.Skywake;

Skywake sky = new Skywake();`,
      csharp: `using Skywake;

using var sky = new SkywakeClient();`,
    },
  },
  {
    slug: "create-index",
    title: "Create an index",
    description:
      "Make an index with a vector column and two attributes. Needs an admin key. The part of the name before the first slash is the environment; products has none, so it goes in default.",
    examples: {
      typescript: `const products = await sky.createIndex("products", {
  schema: {
    vectors: [{ name: "embedding", dims: 3 }],
    attributes: [
      { name: "title", type: "text" },
      { name: "price", type: "number" },
    ],
  },
});`,
      python: `products = sky.create_index(
    "products",
    schema={
        "vectors": [{"name": "embedding", "dims": 3}],
        "attributes": [{"name": "title", "type": "text"}, {"name": "price", "type": "number"}],
    },
)`,
      go: `products, err := sky.CreateIndex(ctx, "products", skywake.IndexOptions{
	Schema: &skywake.Schema{
		Vectors:    []skywake.VectorColumn{{Name: "embedding", Dims: 3}},
		Attributes: []skywake.AttributeColumn{{Name: "title", Type: "text"}, {Name: "price", Type: "number"}},
	},
})`,
      ruby: `products = sky.create_index(
  "products",
  schema: {
    vectors: [{ name: "embedding", dims: 3 }],
    attributes: [{ name: "title", type: "text" }, { name: "price", type: "number" }]
  }
)`,
      rust: `use serde_json::json;

let products = sky
    .create_index("products")
    .schema(json!({
        "vectors": [{ "name": "embedding", "dims": 3 }],
        "attributes": [
            { "name": "title", "type": "text" },
            { "name": "price", "type": "number" },
        ],
    }))
    .await?;`,
      java: `Index products = sky.createIndex("products", new IndexOptions().schema(Map.of(
        "vectors", List.of(Map.of("name", "embedding", "dims", 3)),
        "attributes", List.of(
                Map.of("name", "title", "type", "text"),
                Map.of("name", "price", "type", "number")))));`,
      csharp: `var products = await sky.CreateIndexAsync("products", new NewIndexOptions
{
    Schema = new
    {
        vectors = new[] { new { name = "embedding", dims = 3 } },
        attributes = new[] { new { name = "title", type = "text" }, new { name = "price", type = "number" } },
    },
});`,
    },
  },
  {
    slug: "upsert",
    title: "Upsert documents",
    description: "Write documents. Each replaces any earlier one with its id.",
    examples: {
      typescript: `const { count } = await sky.index("products").upsert([
  { id: 1, embedding: [0.1, 0.2, 0.3], title: "Desk lamp", price: 40 },
  { id: 2, embedding: [0.3, 0.1, 0.2], title: "Red mug", price: 9 },
]);`,
      python: `done = sky.index("products").upsert([
    {"id": 1, "embedding": [0.1, 0.2, 0.3], "title": "Desk lamp", "price": 40},
    {"id": 2, "embedding": [0.3, 0.1, 0.2], "title": "Red mug", "price": 9},
])`,
      go: `done, err := sky.Index("products").Upsert(ctx,
	skywake.Row{"id": 1, "embedding": []float64{0.1, 0.2, 0.3}, "title": "Desk lamp", "price": 40},
	skywake.Row{"id": 2, "embedding": []float64{0.3, 0.1, 0.2}, "title": "Red mug", "price": 9},
)`,
      ruby: `done = sky.index("products").upsert([
  { id: 1, embedding: [0.1, 0.2, 0.3], title: "Desk lamp", price: 40 },
  { id: 2, embedding: [0.3, 0.1, 0.2], title: "Red mug", price: 9 }
])`,
      rust: `use serde_json::json;

let done = sky
    .index("products")
    .upsert(json!([
        { "id": 1, "embedding": [0.1, 0.2, 0.3], "title": "Desk lamp", "price": 40 },
        { "id": 2, "embedding": [0.3, 0.1, 0.2], "title": "Red mug", "price": 9 },
    ]))
    .await?;`,
      java: `Upserted done = sky.index("products").upsert(List.of(
        Map.of("id", 1, "embedding", List.of(0.1, 0.2, 0.3), "title", "Desk lamp", "price", 40),
        Map.of("id", 2, "embedding", List.of(0.3, 0.1, 0.2), "title", "Red mug", "price", 9)));`,
      csharp: `var done = await sky.Index("products").UpsertAsync(new[]
{
    new { id = 1, embedding = new[] { 0.1, 0.2, 0.3 }, title = "Desk lamp", price = 40 },
    new { id = 2, embedding = new[] { 0.3, 0.1, 0.2 }, title = "Red mug", price = 9 },
});`,
    },
  },
  {
    slug: "query",
    title: "Query by vector",
    description: "Find the documents nearest to a vector, nearest first.",
    examples: {
      typescript: `const hits = await sky.index("products").query({ vector: [0.1, 0.2, 0.3], limit: 5 });
for (const hit of hits) console.log(hit.id, hit.score);`,
      python: `hits = sky.index("products").query(vector=[0.1, 0.2, 0.3], limit=5)
for hit in hits:
    print(hit["id"], hit["score"])`,
      go: `hits, err := sky.Index("products").Query(ctx, "", skywake.QueryOptions{Vector: []float64{0.1, 0.2, 0.3}, Limit: 5})
if err != nil {
	return err
}
for _, hit := range hits {
	fmt.Println(hit["id"], hit["score"])
}`,
      ruby: `hits = sky.index("products").query(vector: [0.1, 0.2, 0.3], limit: 5)
hits.each { |hit| puts hit["id"], hit["score"] }`,
      rust: `let hits = sky.index("products").query(None).vector([0.1, 0.2, 0.3]).limit(5).await?;
for hit in &hits {
    println!("{} {}", hit["id"], hit["score"]);
}`,
      java: `List<Map<String, Object>> hits = sky.index("products")
        .query(new QueryOptions().vector(0.1, 0.2, 0.3).limit(5));
for (Map<String, Object> hit : hits) {
    System.out.println(hit.get("id") + " " + hit.get("score"));
}`,
      csharp: `var hits = await sky.Index("products").QueryAsync(new QueryOptions { Vector = new[] { 0.1f, 0.2f, 0.3f }, Limit = 5 });
foreach (var hit in hits)
{
    Console.WriteLine($"{hit["id"]} {hit["score"]}");
}`,
    },
  },
  {
    slug: "search",
    title: "Full-text search",
    description: "Find the documents that best match words by BM25, best first.",
    examples: {
      typescript: `const hits = await sky.index("products").query("desk lamp", { mode: "keywords", limit: 5 });
for (const hit of hits) console.log(hit.id, hit.score);`,
      python: `hits = sky.index("products").query("desk lamp", mode="keywords", limit=5)
for hit in hits:
    print(hit["id"], hit["score"])`,
      go: `hits, err := sky.Index("products").Query(ctx, "desk lamp", skywake.QueryOptions{Mode: "keywords", Limit: 5})
if err != nil {
	return err
}
for _, hit := range hits {
	fmt.Println(hit["id"], hit["score"])
}`,
      ruby: `hits = sky.index("products").query("desk lamp", mode: "keywords", limit: 5)
hits.each { |hit| puts hit["id"], hit["score"] }`,
      rust: `use skywake::Mode;

let hits = sky.index("products").query("desk lamp").mode(Mode::Keywords).limit(5).await?;
for hit in &hits {
    println!("{} {}", hit["id"], hit["score"]);
}`,
      java: `List<Map<String, Object>> hits = sky.index("products")
        .query("desk lamp", new QueryOptions().mode(Mode.KEYWORDS).limit(5));
for (Map<String, Object> hit : hits) {
    System.out.println(hit.get("id") + " " + hit.get("score"));
}`,
      csharp: `var hits = await sky.Index("products").QueryAsync("desk lamp", new QueryOptions { Mode = QueryMode.Keywords, Limit = 5 });
foreach (var hit in hits)
{
    Console.WriteLine($"{hit["id"]} {hit["score"]}");
}`,
    },
  },
  {
    slug: "hybrid",
    title: "Hybrid search",
    description: "Run a vector query and a text search on one snapshot and fuse their ranks.",
    examples: {
      typescript: `const hits = await sky.index("products").query("desk lamp", { limit: 5 });
for (const hit of hits) console.log(hit.id, hit.score);`,
      python: `hits = sky.index("products").query("desk lamp", limit=5)
for hit in hits:
    print(hit["id"], hit["score"])`,
      go: `hits, err := sky.Index("products").Query(ctx, "desk lamp", skywake.QueryOptions{Limit: 5})
if err != nil {
	return err
}
for _, hit := range hits {
	fmt.Println(hit["id"], hit["score"])
}`,
      ruby: `hits = sky.index("products").query("desk lamp", limit: 5)
hits.each { |hit| puts hit["id"], hit["score"] }`,
      rust: `let hits = sky.index("products").query("desk lamp").limit(5).await?;
for hit in &hits {
    println!("{} {}", hit["id"], hit["score"]);
}`,
      java: `List<Map<String, Object>> hits = sky.index("products").query("desk lamp", new QueryOptions().limit(5));
for (Map<String, Object> hit : hits) {
    System.out.println(hit.get("id") + " " + hit.get("score"));
}`,
      csharp: `var hits = await sky.Index("products").QueryAsync("desk lamp", new QueryOptions { Limit = 5 });
foreach (var hit in hits)
{
    Console.WriteLine($"{hit["id"]} {hit["score"]}");
}`,
    },
  },
  {
    slug: "filter",
    title: "Filter a query",
    description: "Keep only the hits whose attributes pass a filter.",
    examples: {
      typescript: `const hits = await sky.index("products").query({
  vector: [0.1, 0.2, 0.3],
  limit: 5,
  filter: { and: [{ price: { gte: 20 } }, { price: { lt: 50 } }] },
});`,
      python: `hits = sky.index("products").query(
    vector=[0.1, 0.2, 0.3],
    limit=5,
    filter={"and": [{"price": {"gte": 20}}, {"price": {"lt": 50}}]},
)`,
      go: `hits, err := sky.Index("products").Query(ctx, "", skywake.QueryOptions{
	Vector: []float64{0.1, 0.2, 0.3},
	Limit:  5,
	Filter: skywake.Filter{"and": []skywake.Filter{{"price": skywake.Filter{"gte": 20}}, {"price": skywake.Filter{"lt": 50}}}},
})`,
      ruby: `hits = sky.index("products").query(
  vector: [0.1, 0.2, 0.3],
  limit: 5,
  filter: { and: [{ price: { gte: 20 } }, { price: { lt: 50 } }] }
)`,
      rust: `use serde_json::json;

let hits = sky
    .index("products")
    .query(None)
    .vector([0.1, 0.2, 0.3])
    .limit(5)
    .filter(json!({ "and": [{ "price": { "gte": 20 } }, { "price": { "lt": 50 } }] }))
    .await?;`,
      java: `List<Map<String, Object>> hits = sky.index("products").query(new QueryOptions()
        .vector(0.1, 0.2, 0.3)
        .limit(5)
        .filter(Map.of("and", List.of(
                Map.of("price", Map.of("gte", 20)),
                Map.of("price", Map.of("lt", 50))))));`,
      csharp: `var hits = await sky.Index("products").QueryAsync(new QueryOptions
{
    Vector = new[] { 0.1f, 0.2f, 0.3f },
    Limit = 5,
    Filter = new { and = new object[] { new { price = new { gte = 20 } }, new { price = new { lt = 50 } } } },
});`,
    },
  },
  {
    slug: "fork",
    title: "Fork an index branch",
    description: "Fork a branch to change it in isolation. Nothing is copied.",
    examples: {
      typescript: `const trial = await sky.index("products").fork("try");
await trial.delete({ filter: { price: { gt: 100 } } });`,
      python: `trial = sky.index("products").fork("try")
trial.delete({"filter": {"price": {"gt": 100}}})`,
      go: `trial, err := sky.Index("products").Fork(ctx, "try")
if err != nil {
	return err
}
_, err = trial.Delete(ctx, skywake.Filter{"filter": skywake.Filter{"price": skywake.Filter{"gt": 100}}})`,
      ruby: `trial = sky.index("products").fork("try")
trial.delete({ filter: { price: { gt: 100 } } })`,
      rust: `use serde_json::json;

let trial = sky.index("products").fork("try").await?;
trial.delete(json!({ "filter": { "price": { "gt": 100 } } })).await?;`,
      java: `Index trial = sky.index("products").fork("try");
trial.delete(Map.of("filter", Map.of("price", Map.of("gt", 100))));`,
      csharp: `var trial = await sky.Index("products").ForkAsync("try");
await trial.DeleteAsync(Target.Where(new { price = new { gt = 100 } }));`,
    },
  },
  {
    slug: "merge",
    title: "Merge an index branch",
    description: "Bring a branch's writes back into the branch it forked from.",
    examples: {
      typescript: `const trial = sky.index("products", { branch: "try" });
const { rows } = await trial.mergeInto("main");
await trial.destroy();`,
      python: `trial = sky.index("products", branch="try")
merged = trial.merge_into("main")
trial.destroy()`,
      go: `trial := sky.Index("products", "try")
merged, err := trial.MergeInto(ctx, "main")
if err != nil {
	return err
}
err = trial.Destroy(ctx)`,
      ruby: `trial = sky.index("products", branch: "try")
merged = trial.merge_into("main")
trial.destroy`,
      rust: `let trial = sky.index("products").on("try");
let merged = trial.merge_into("main").await?;
trial.destroy().await?;`,
      java: `Index trial = sky.index("products", "try");
IndexMerged merged = trial.mergeInto("main");
trial.destroy();`,
      csharp: `var trial = sky.Index("products", branch: "try");
var merged = await trial.MergeIntoAsync("main");
await trial.DestroyAsync();`,
    },
  },
  {
    slug: "fork-filesystem",
    title: "Fork a filesystem branch",
    description: "Fork a branch of a namespace. No data is copied.",
    examples: {
      typescript: `const work = await sky.disk("acme").fork("agent-42");
console.log(work.branch);`,
      python: `work = sky.disk("acme").fork("agent-42")
print(work.branch)`,
      go: `work, err := sky.Disk("acme").Fork(ctx, "agent-42")
if err != nil {
	return err
}
fmt.Println(work.Branch)`,
      ruby: `work = sky.disk("acme").fork("agent-42")
puts work.branch`,
      rust: `let work = sky.disk("acme").fork("agent-42").await?;
println!("{}", work.branch());`,
      java: `Disk work = sky.disk("acme").fork("agent-42");
System.out.println(work.branch());`,
      csharp: `var work = await sky.Disk("acme").ForkAsync("agent-42");
Console.WriteLine(work.Branch);`,
    },
  },
  {
    slug: "commit-files",
    title: "Commit files",
    description: "Write, change or remove files on a branch as one commit.",
    examples: {
      typescript: `const work = sky.disk("acme", { branch: "agent-42" });
const { commit } = await work.write({ "notes.md": "hello", "todo.md": "ship docs" }, { message: "add notes" });
await work.delete("todo.md", { message: "drop the todo" });`,
      python: `work = sky.disk("acme", branch="agent-42")
done = work.write({"notes.md": "hello", "todo.md": "ship docs"}, message="add notes")
work.delete("todo.md", message="drop the todo")`,
      go: `work := sky.Disk("acme", "agent-42")
done, err := work.WriteFiles(ctx, map[string][]byte{
	"notes.md": []byte("hello"),
	"todo.md":  []byte("ship docs"),
}, skywake.WriteOptions{Message: "add notes"})
if err != nil {
	return err
}
_, err = work.Delete(ctx, "todo.md", skywake.CommitOptions{Message: "drop the todo"})`,
      ruby: `work = sky.disk("acme", branch: "agent-42")
done = work.write({ "notes.md" => "hello", "todo.md" => "ship docs" }, message: "add notes")
work.delete("todo.md", message: "drop the todo")`,
      rust: `let work = sky.disk("acme").on("agent-42");
let done = work
    .write_files([("notes.md", "hello"), ("todo.md", "ship docs")])
    .message("add notes")
    .await?;
work.delete("todo.md").message("drop the todo").await?;`,
      java: `Disk work = sky.disk("acme", "agent-42");
Committed done = work.write(
        Map.of("notes.md", "hello", "todo.md", "ship docs"), new WriteOptions().message("add notes"));
work.delete("todo.md", "drop the todo");`,
      csharp: `var work = sky.Disk("acme", branch: "agent-42");
var done = await work.WriteAsync(
    new Dictionary<string, string> { ["notes.md"] = "hello", ["todo.md"] = "ship docs" },
    new WriteOptions { Message = "add notes" });
await work.DeleteAsync("todo.md", message: "drop the todo");`,
    },
  },
  {
    slug: "read-file",
    title: "Read a file",
    description: "Read a file from a branch, whole or a range of its bytes.",
    examples: {
      typescript: `const work = sky.disk("acme", { branch: "agent-42" });
const text = await work.read("notes.md");
const bytes = await work.read("notes.md", { as: "bytes", offset: 0, length: 5 });`,
      python: `work = sky.disk("acme", branch="agent-42")
text = work.read("notes.md")
data = work.read("notes.md", binary=True, offset=0, length=5)`,
      go: `work := sky.Disk("acme", "agent-42")
text, err := work.Read(ctx, "notes.md")
data, err := work.ReadBytes(ctx, "notes.md", skywake.ReadOptions{Offset: 0, Length: 5})`,
      ruby: `work = sky.disk("acme", branch: "agent-42")
text = work.read("notes.md")
data = work.read("notes.md", binary: true, offset: 0, length: 5)`,
      rust: `let work = sky.disk("acme").on("agent-42");
let text = work.read("notes.md").await?;
let bytes = work.read("notes.md").offset(0).length(5).bytes().await?;`,
      java: `Disk work = sky.disk("acme", "agent-42");
String text = work.read("notes.md");
byte[] bytes = work.readBytes("notes.md", new ReadOptions().offset(0).length(5));`,
      csharp: `var work = sky.Disk("acme", branch: "agent-42");
var text = await work.ReadAsync("notes.md");
var bytes = await work.ReadBytesAsync("notes.md", new ReadOptions { Offset = 0, Length = 5 });`,
    },
  },
];
