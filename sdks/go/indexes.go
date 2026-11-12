package skywake

import (
	"context"
	"iter"
	"net/url"
	"strconv"
)

// Indexes are the organization's indexes.
type Indexes struct {
	c *Client
}

// Create makes an index with an empty main branch.
func (x Indexes) Create(ctx context.Context, index NewIndex) (*SearchIndex, error) {
	if err := x.c.call(ctx, "POST", "/indexes", nil, index, nil); err != nil {
		return nil, err
	}
	return x.c.Index(index.Name), nil
}

// List returns one page of indexes, in name order. A limit of 0 is 1000.
func (x Indexes) List(ctx context.Context, limit int, after string) ([]Index, error) {
	return fetch[[]Index](ctx, x.c, "GET", "/indexes", page(limit, after), nil)
}

// All yields every index, a page at a time.
func (x Indexes) All(ctx context.Context) iter.Seq2[Index, error] {
	return every(ctx, x.List, func(i Index) string { return i.Name })
}

// Get returns the index, with the counts of main.
func (x Indexes) Get(ctx context.Context, name string) (*Index, error) {
	index, err := fetch[Index](ctx, x.c, "GET", "/indexes/"+escape(name), nil, nil)
	return &index, err
}

// Usage returns queries, writes and size per day over the last days days
// (14 for 0), oldest first.
func (x Indexes) Usage(ctx context.Context, name string, days int) ([]UsageDay, error) {
	query := url.Values{}
	if days > 0 {
		query.Set("days", strconv.Itoa(days))
	}
	usage, err := fetch[struct{ Days []UsageDay }](ctx, x.c, "GET", "/indexes/"+escape(name)+"/usage", query, nil)
	return usage.Days, err
}

// Update adds attributes, makes the index read-only or writable again, or
// pins or unpins it. An attribute it has must keep its type.
func (x Indexes) Update(ctx context.Context, name string, update UpdateIndex) (*Index, error) {
	index, err := fetch[Index](ctx, x.c, "PATCH", "/indexes/"+escape(name), nil, update)
	return &index, err
}

// Delete deletes the index, every branch and all its data.
func (x Indexes) Delete(ctx context.Context, name string) error {
	return x.c.call(ctx, "DELETE", "/indexes/"+escape(name), nil, nil, nil)
}
