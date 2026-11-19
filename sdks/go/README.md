# Skywake for Go

An open-source search index on your own bucket: vector and full-text search, filters and aggregates. Standard library only, Go 1.23 or later.

```bash
go get github.com/skywakehq/skywake/sdks/go
```

```go
sky, err := skywake.New()
ctx := context.Background()

products := sky.Index("products")
products.Upsert(ctx, skywake.Row{"id": "mug", "text": "a blue coffee mug", "price": 12})
hits, err := products.Query(ctx, "coffee mug", skywake.QueryOptions{
	Filter: skywake.Filter{"price": skywake.Filter{"lt": 20}},
	Limit:  5,
})

draft, err := products.Fork(ctx, "draft")
draft.Update(ctx, "mug", skywake.Row{"price": 9})
draft.MergeInto(ctx, "main")
```

`skywake.New` reads the key from `SKYWAKE_API_KEY`, then from the profile `skywake login` saved. Pass `skywake.WithKey`, `skywake.WithURL` or `skywake.WithEnvironment` to set them in code.

Lists are iterators: `for index, err := range sky.ListIndexes(ctx)`. Errors work with `errors.As`, for example `*skywake.NotFound` or `*skywake.PermissionError`.
