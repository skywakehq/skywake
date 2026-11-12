package skywake

import (
	"context"
	"iter"
	"net/url"
	"strconv"
)

// pageSize is the most items a page of a list holds.
const pageSize = 1000

// page is the query of one page of a list: at most limit items, after the key after.
func page(limit int, after string) url.Values {
	return pageQuery(limit, "after", after)
}

// pageQuery asks for at most limit items, starting from the key named name.
// A zero limit or an empty key leaves that part to the server.
func pageQuery(limit int, name, from string) url.Values {
	query := url.Values{}
	if limit > 0 {
		query.Set("limit", strconv.Itoa(limit))
	}
	if from != "" {
		query.Set(name, from)
	}
	return query
}

// every yields every item of a list, asking for one page at a time until a
// short one.
func every[T any](ctx context.Context, list func(context.Context, int, string) ([]T, error), key func(T) string) iter.Seq2[T, error] {
	return func(yield func(T, error) bool) {
		after := ""
		for {
			items, err := list(ctx, pageSize, after)
			if err != nil {
				var zero T
				yield(zero, err)
				return
			}
			for _, item := range items {
				if !yield(item, nil) {
					return
				}
			}
			if len(items) < pageSize {
				return
			}
			after = key(items[len(items)-1])
		}
	}
}
