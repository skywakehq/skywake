# Skywake for Go

A client for Skywake search indexes. Standard library only.

```bash
go get github.com/skywakehq/skywake/sdks/go
```

```go
sky := skywake.New("https://api.skywake.dev", os.Getenv("SKYWAKE_KEY"))
ctx := context.Background()

products, _ := sky.Indexes.Create(ctx, skywake.NewIndex{
	Name: "products",
	Schema: skywake.Schema{
		Vectors:    []skywake.VectorColumn{{Name: "embedding", Dims: 3}},
		Attributes: []skywake.Attribute{{Name: "title", Type: "text"}, {Name: "price", Type: "number"}},
	},
})
products.Upsert(ctx, []skywake.Document{{
	ID:         1,
	Vectors:    map[string]any{"embedding": []float32{0.1, 0.2, 0.3}},
	Attributes: map[string]any{"title": "Desk lamp", "price": 40},
}})

hits, _ := products.Query(ctx, skywake.Query{
	Vector: skywake.Vector{Column: "embedding", Value: []float32{0.1, 0.2, 0.3}},
	TopK:   5,
	Filter: map[string]any{"price": map[string]any{"lt": 50}},
})
fmt.Println(hits.Items, hits.Performance.ServerMS)
```

- **Branches.** `products.Fork(ctx, "try")` copies nothing; `At(branch)` reads
  another; `Merge(ctx, "try")` brings its writes back.
- **Reads.** `Query`, `Search` (BM25), `Hybrid`, `Order`, `Rank` (sparse and
  late-interaction scores), `Aggregate`, and `Multi` for several on one snapshot.
  Each returns `Items`, `Performance` and `Billing`.
- **Writes.** `Upsert`, `Patch` and `Delete` send 1,000 at a time; `Write` is one
  change with conditions.
- **Lists.** `AllBranches`, `AllDocuments`, `Indexes.All` and `Export` are
  `range`-able and read a page at a time.
- **Errors** are `*skywake.Error` with `Status`, `Code`, `RequestID` and, for a bad
  request, the `Path` of the field that is wrong. A 429 is always retried; a
  network error or 5xx only for GET, PUT and DELETE.
