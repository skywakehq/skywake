package skywake

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"iter"
	"time"
)

const (
	upsertCount = 10_000
	upsertBytes = 24 * 1024 * 1024
	rowPage     = 1000
)

type Index struct {
	Name   string
	Branch string
	http   *transport
}

func (x *Index) path() string { return "/indexes/" + segment(x.Name) }

func (x *Index) on() params { return params{"branch": x.Branch} }

func (x *Index) On(branch string) *Index {
	return &Index{Name: x.Name, Branch: branch, http: x.http}
}

func (x *Index) Upsert(ctx context.Context, rows ...Row) (Upserted, error) {
	done := Upserted{IDs: []any{}}
	weigh := func(row Row) int {
		encoded, _ := json.Marshal(row)
		return len(encoded)
	}
	for _, batch := range batches(rows, upsertCount, upsertBytes, weigh) {
		var got Upserted
		if err := x.http.post(ctx, x.path()+"/rows", batch, x.on(), &got); err != nil {
			return done, err
		}
		done.IDs = append(done.IDs, got.IDs...)
		done.Count += got.Count
	}
	return done, nil
}

func (x *Index) Update(ctx context.Context, target any, fields Row) (int, error) {
	body, err := targetOf(target)
	if err != nil {
		return 0, err
	}
	body["fields"] = fields
	var got struct{ Count int }
	err = x.http.patch(ctx, x.path()+"/rows", body, x.on(), &got)
	return got.Count, err
}

func (x *Index) Delete(ctx context.Context, target any) (int, error) {
	body, err := targetOf(target)
	if err != nil {
		return 0, err
	}
	var got struct{ Count int }
	err = x.http.post(ctx, x.path()+"/rows/delete", body, x.on(), &got)
	return got.Count, err
}

func (x *Index) Get(ctx context.Context, id any) (Row, error) {
	var row Row
	err := x.http.get(ctx, x.path()+"/rows/"+segment(fmt.Sprint(id)), x.on(), &row)
	var missing *NotFound
	if errors.As(err, &missing) && missing.Path == "id" {
		return nil, nil
	}
	return row, err
}

func (x *Index) Query(ctx context.Context, text string, options ...QueryOptions) ([]Hit, error) {
	body := struct {
		Text string `json:"text,omitempty"`
		QueryOptions
		Branch string `json:"branch"`
	}{text, first(options), x.Branch}
	return onePage[Hit](ctx, x.http, x.path()+"/query", body)
}

func (x *Index) Count(ctx context.Context, filter Filter) (int, error) {
	body := map[string]any{"branch": x.Branch}
	if filter != nil {
		body["filter"] = filter
	}
	var got struct{ Count int }
	err := x.http.post(ctx, x.path()+"/count", body, nil, &got)
	return got.Count, err
}

func (x *Index) Aggregate(ctx context.Context, options AggregateOptions) ([]Group, error) {
	body := struct {
		AggregateOptions
		Branch string `json:"branch"`
	}{options, x.Branch}
	return onePage[Group](ctx, x.http, x.path()+"/aggregate", body)
}

func (x *Index) Rows(ctx context.Context, filter Filter) iter.Seq2[Row, error] {
	if filter != nil {
		return x.matching(ctx, filter)
	}
	return listing[Row](ctx, x.http, x.path()+"/rows", x.on().with("limit", fmt.Sprint(rowPage)))
}

func (x *Index) matching(ctx context.Context, filter Filter) iter.Seq2[Row, error] {
	return func(yield func(Row, error) bool) {
		where := filter
		for {
			hits, err := x.Query(ctx, "", QueryOptions{Filter: where, Limit: rowPage})
			if err != nil {
				yield(nil, err)
				return
			}
			for _, hit := range hits {
				delete(hit, "score")
				if !yield(hit, nil) {
					return
				}
			}
			if len(hits) < rowPage {
				return
			}
			last := hits[len(hits)-1]["id"]
			where = Filter{"and": []any{filter, Filter{"id": Filter{"gt": last}}}}
		}
	}
}

func (x *Index) Fork(ctx context.Context, name string, options ...ForkOptions) (*Index, error) {
	if err := fork(ctx, x.http, x.path(), name, x.Branch, first(options)); err != nil {
		return nil, err
	}
	return x.On(name), nil
}

func (x *Index) MergeInto(ctx context.Context, into string) (IndexMerged, error) {
	var merged IndexMerged
	body := map[string]any{"from": x.Branch, "into": firstSet(into, Main)}
	err := x.http.post(ctx, x.path()+"/merges", body, nil, &merged)
	return merged, err
}

func (x *Index) Destroy(ctx context.Context) error {
	return destroy(ctx, x.http, x.path(), x.Branch)
}

func (x *Index) Branches(ctx context.Context) ([]Branch, error) {
	return Collect(listing[Branch](ctx, x.http, x.path()+"/branches", nil))
}

func (x *Index) Versions(ctx context.Context) ([]Version, error) {
	return Collect(listing[Version](ctx, x.http, x.path()+"/versions", x.on()))
}

func (x *Index) Restore(ctx context.Context, version string) (Version, error) {
	var restored Version
	body := map[string]any{"to": version, "branch": x.Branch}
	err := x.http.post(ctx, x.path()+"/restore", body, nil, &restored)
	return restored, err
}

func (x *Index) RestoreTo(ctx context.Context, at time.Time) (Version, error) {
	return x.Restore(ctx, at.UTC().Format(time.RFC3339Nano))
}

func (x *Index) Copy(ctx context.Context, name string, options ...CopyOptions) (*Index, error) {
	environment := first(options).Environment
	body := compact(map[string]any{"name": name, "environment": environment})
	if err := x.http.post(ctx, x.path()+"/copy", body, nil, nil); err != nil {
		return nil, err
	}
	http := x.http
	if environment != "" {
		http = http.in(environment)
	}
	return &Index{Name: name, Branch: Main, http: http}, nil
}

func (x *Index) Info(ctx context.Context) (IndexInfo, error) {
	var info IndexInfo
	err := x.http.get(ctx, x.path(), nil, &info)
	return info, err
}

func (x *Index) Configure(ctx context.Context, settings IndexSettings) (IndexInfo, error) {
	var info IndexInfo
	err := x.http.patch(ctx, x.path(), settings, nil, &info)
	return info, err
}
