# Skywake for Go

Shared, branchable disks for AI agents, with search over their files. Standard library only, Go 1.23 or later.

```bash
go get github.com/skywakehq/skywake/sdks/go
```

```go
sky, err := skywake.New()
ctx := context.Background()

search := true
app, err := sky.CreateDisk(ctx, "app", skywake.DiskOptions{Search: &search})
app.Write(ctx, "README.md", []byte("# App\n"))
text, err := app.Read(ctx, "README.md")
hits, err := app.Query(ctx, "app readme", skywake.SearchOptions{Limit: 5})
```

`skywake.New` reads the key from `SKYWAKE_API_KEY`, then from the profile `skywake login` saved. Pass `skywake.WithKey`, `skywake.WithURL` or `skywake.WithEnvironment` to set them in code.

Lists are iterators: `for disk, err := range sky.ListDisks(ctx)`. Errors work with `errors.As`, for example `*skywake.NotFound` or `*skywake.MergeConflict`.
