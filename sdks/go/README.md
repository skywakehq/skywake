# Skywake for Go

Disks and search indexes for AI agents. Standard library only, Go 1.23 or later.

```bash
go get github.com/skywakehq/skywake/sdks/go
```

```go
sky, err := skywake.New()
ctx := context.Background()

products := sky.Index("products")
products.Upsert(ctx, skywake.Row{"id": "mug", "text": "a blue coffee mug", "price": 12})
hits, err := products.Query(ctx, "coffee mug", skywake.QueryOptions{Limit: 5})

app := sky.Disk("app")
app.Write(ctx, "README.md", []byte("# App\n"))
text, err := app.Read(ctx, "README.md")
```

`skywake.New` reads the key from `SKYWAKE_API_KEY`, then from the profile `skywake login` saved. Pass `skywake.WithKey`, `skywake.WithURL` or `skywake.WithEnvironment` to set them in code.

Lists are iterators: `for disk, err := range sky.ListDisks(ctx)`. Errors work with `errors.As`, for example `*skywake.NotFound` or `*skywake.MergeConflict`.
