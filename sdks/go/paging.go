package skywake

import (
	"context"
	"iter"
)

type page[T any] struct {
	Data []T    `json:"data"`
	Next string `json:"next"`
}

func pages[T any](load func(cursor string) (page[T], error)) iter.Seq2[T, error] {
	return func(yield func(T, error) bool) {
		for cursor := ""; ; {
			loaded, err := load(cursor)
			if err != nil {
				var zero T
				yield(zero, err)
				return
			}
			for _, item := range loaded.Data {
				if !yield(item, nil) {
					return
				}
			}
			if loaded.Next == "" {
				return
			}
			cursor = loaded.Next
		}
	}
}

func listing[T any](ctx context.Context, t *transport, path string, query params) iter.Seq2[T, error] {
	return pages(func(cursor string) (page[T], error) {
		var loaded page[T]
		err := t.get(ctx, path, query.with("cursor", cursor), &loaded)
		return loaded, err
	})
}

func onePage[T any](ctx context.Context, t *transport, path string, body any) ([]T, error) {
	var loaded page[T]
	err := t.post(ctx, path, body, nil, &loaded)
	return loaded.Data, err
}

func Collect[T any](items iter.Seq2[T, error]) ([]T, error) {
	all := []T{}
	for item, err := range items {
		if err != nil {
			return nil, err
		}
		all = append(all, item)
	}
	return all, nil
}
