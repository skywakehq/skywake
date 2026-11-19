package skywake_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	skywake "github.com/skywakehq/skywake/sdks/go"
)

var ctx = context.Background()

func TestRequestsGoToV2WithTheKeyAndTheEnvironment(t *testing.T) {
	a := fake(t, func(seen, int) reply {
		return reply{body: map[string]any{"organization": "acme", "environment": "prod"}}
	})
	me := must(a.sky(t, skywake.WithEnvironment("prod")).Whoami(ctx))
	got := a.requests()[0]
	same(t, []any{me.Environment, got.path, got.headers.Get("authorization"), got.headers.Get("skywake-environment")},
		[]any{"prod", "/v2/whoami", "Bearer k", "prod"})
}

func TestEachStatusBecomesItsOwnErrorWithTheHintInTheMessage(t *testing.T) {
	replies := []reply{
		failure(401, "unauthorized", nil),
		failure(403, "forbidden", nil),
		failure(404, "not_found", map[string]any{"hint": "did you mean `products`?"}),
		failure(500, "internal", nil),
	}
	a := fake(t, func(_ seen, count int) reply { return replies[min(count, 4)-1] })
	sky := a.sky(t, skywake.WithRetries(0))
	_, err := sky.Whoami(ctx)
	var auth *skywake.AuthError
	if !errors.As(err, &auth) {
		t.Fatalf("want AuthError, got %v", err)
	}
	_, err = sky.Whoami(ctx)
	var forbidden *skywake.PermissionError
	if !errors.As(err, &forbidden) {
		t.Fatalf("want PermissionError, got %v", err)
	}
	_, err = sky.Index("prodcts").Info(ctx)
	var missing *skywake.NotFound
	if !errors.As(err, &missing) {
		t.Fatalf("want NotFound, got %v", err)
	}
	if missing.Hint != "did you mean `products`?" || missing.RequestID != "req-1" || missing.Status != 404 {
		t.Fatalf("fields: %+v", missing)
	}
	if !strings.Contains(err.Error(), "did you mean `products`?") {
		t.Fatalf("message: %s", err)
	}
	_, err = sky.Whoami(ctx)
	var server *skywake.ServerError
	if !errors.As(err, &server) {
		t.Fatalf("want ServerError, got %v", err)
	}
}

func TestA429IsRetriedAsTheServerAsksThenReportedWithRetryAfter(t *testing.T) {
	limited := failure(429, "rate_limited", nil)
	limited.headers = map[string]string{"retry-after": "1"}
	a := fake(t, func(seen, int) reply { return limited })
	_, err := a.sky(t, skywake.WithRetries(1)).Whoami(ctx)
	var rate *skywake.RateLimited
	if !errors.As(err, &rate) || rate.RetryAfter != time.Second {
		t.Fatalf("want RateLimited after 1s, got %v", err)
	}
	if n := len(a.requests()); n != 2 {
		t.Fatalf("want 2 tries, got %d", n)
	}
}

func TestA5xxIsRetriedForAGetButNotForAPost(t *testing.T) {
	a := fake(t, func(_ seen, count int) reply {
		if count == 1 || count == 3 {
			return failure(503, "unavailable", nil)
		}
		return reply{body: map[string]any{"organization": "acme"}}
	})
	sky := a.sky(t)
	must(sky.Whoami(ctx))
	_, err := sky.CreateEnvironment(ctx, "prod")
	var server *skywake.ServerError
	if !errors.As(err, &server) || len(a.requests()) != 3 {
		t.Fatalf("want one POST, got %v after %d requests", err, len(a.requests()))
	}
}

func TestAMergeThatCantFinishIsAMergeConflictListingWhatConflicts(t *testing.T) {
	a := fake(t, func(seen, int) reply {
		return failure(409, "conflict", map[string]any{"conflicts": []string{"mug"}})
	})
	_, err := a.sky(t).Index("products", "agent-1").MergeInto(ctx, "")
	var merge *skywake.MergeConflict
	if !errors.As(err, &merge) {
		t.Fatalf("want MergeConflict, got %v", err)
	}
	same(t, merge.Conflicts, []string{"mug"})
	var conflict *skywake.Conflict
	if !errors.As(err, &conflict) {
		t.Fatal("a MergeConflict is also a Conflict")
	}
	same(t, a.requests()[0].json(t), map[string]any{"from": "agent-1", "into": "main"})
}

func TestListsFollowNextUntilTheLastPage(t *testing.T) {
	a := fake(t, func(s seen, _ int) reply {
		if s.query.Get("cursor") == "b" {
			return reply{body: map[string]any{"data": []any{map[string]any{"name": "c"}}, "next": nil}}
		}
		return reply{body: map[string]any{"data": []any{map[string]any{"name": "a"}, map[string]any{"name": "b"}}, "next": "b"}}
	})
	var names []string
	for index, err := range a.sky(t).ListIndexes(ctx) {
		if err != nil {
			t.Fatal(err)
		}
		names = append(names, index.Name)
	}
	same(t, names, []string{"a", "b", "c"})
}

func TestUpsertTakesAnyNumberOfRowsAndSendsThemInBatches(t *testing.T) {
	a := fake(t, func(s seen, _ int) reply {
		rows := s.json(t).([]any)
		ids := make([]any, len(rows))
		for i, row := range rows {
			ids[i] = row.(map[string]any)["id"]
		}
		return reply{body: map[string]any{"ids": ids, "count": len(rows)}}
	})
	rows := make([]skywake.Row, 25_000)
	for i := range rows {
		rows[i] = skywake.Row{"id": i, "text": fmt.Sprintf("row %d", i)}
	}
	done := must(a.sky(t).Index("products").Upsert(ctx, rows...))
	if done.Count != 25_000 || len(done.IDs) != 25_000 {
		t.Fatalf("done: %d, %d ids", done.Count, len(done.IDs))
	}
	var sizes []int
	for _, s := range a.requests() {
		sizes = append(sizes, len(s.json(t).([]any)))
	}
	same(t, sizes, []int{10_000, 10_000, 5_000})
	same(t, a.requests()[0].query.Get("branch"), "main")
}

func TestUpdateAndDeleteTakeAnIdIdsOrAFilter(t *testing.T) {
	a := fake(t, func(seen, int) reply { return reply{body: map[string]any{"count": 1}} })
	products := a.sky(t).Index("products")
	must(products.Update(ctx, 7, skywake.Row{"stock": 3}))
	must(products.Update(ctx, skywake.Filter{"tag": skywake.Filter{"eq": "sale"}}, skywake.Row{"stock": 0}))
	must(products.Delete(ctx, []int{1, 2}))
	must(products.Delete(ctx, skywake.Filter{"filter": skywake.Filter{"stock": skywake.Filter{"eq": 0}}}))
	var got []any
	for _, s := range a.requests() {
		got = append(got, []any{s.method, s.path, s.json(t)})
	}
	same(t, got, []any{
		[]any{"PATCH", "/v2/indexes/products/rows", map[string]any{"id": 7, "fields": map[string]any{"stock": 3}}},
		[]any{"PATCH", "/v2/indexes/products/rows", map[string]any{
			"filter": map[string]any{"tag": map[string]any{"eq": "sale"}}, "fields": map[string]any{"stock": 0},
		}},
		[]any{"POST", "/v2/indexes/products/rows/delete", map[string]any{"ids": []int{1, 2}}},
		[]any{"POST", "/v2/indexes/products/rows/delete", map[string]any{"filter": map[string]any{"stock": map[string]any{"eq": 0}}}},
	})
}

func TestGetGivesNilForAMissingRowButFailsForAMissingIndex(t *testing.T) {
	a := fake(t, func(s seen, _ int) reply {
		if strings.Contains(s.path, "/rows/") {
			return failure(404, "not_found", map[string]any{"path": "id"})
		}
		return failure(404, "not_found", map[string]any{"hint": "did you mean `products`?"})
	})
	sky := a.sky(t)
	row, err := sky.Index("products").Get(ctx, "a b")
	if row != nil || err != nil {
		t.Fatalf("want nil, nil; got %v, %v", row, err)
	}
	same(t, a.requests()[0].path, "/v2/indexes/products/rows/a%20b")
	_, err = sky.Index("prodcts").Info(ctx)
	var missing *skywake.NotFound
	if !errors.As(err, &missing) {
		t.Fatalf("want NotFound, got %v", err)
	}
}

func TestQueryTakesTextFirstAndOptionsOnTheirOwn(t *testing.T) {
	a := fake(t, func(seen, int) reply {
		return reply{body: map[string]any{"data": []any{map[string]any{"id": 1, "score": 0.9, "title": "mug"}}, "next": nil}}
	})
	products := a.sky(t).Index("products", "draft")
	hits := must(products.Query(ctx, "coffee", skywake.QueryOptions{Limit: 3, Mode: "keywords"}))
	same(t, hits[0]["title"], "mug")
	must(products.Query(ctx, "", skywake.QueryOptions{
		Filter: skywake.Filter{"price": skywake.Filter{"lt": 10}},
		Sort:   map[string]string{"price": "asc"},
	}))
	same(t, a.requests()[0].json(t), map[string]any{"text": "coffee", "limit": 3, "mode": "keywords", "branch": "draft"})
	same(t, a.requests()[1].json(t), map[string]any{
		"filter": map[string]any{"price": map[string]any{"lt": 10}},
		"sort":   map[string]any{"price": "asc"},
		"branch": "draft",
	})
}

func TestAForkIsAHandleOnTheNewBranchAndDestroyRemovesJustTheBranch(t *testing.T) {
	a := fake(t, func(s seen, _ int) reply {
		if s.method == "DELETE" {
			return reply{status: 204}
		}
		return reply{status: 201, body: map[string]any{"name": "agent-1"}}
	})
	work := must(a.sky(t).Index("products").Fork(ctx, "agent-1", skywake.ForkOptions{At: "v3"}))
	same(t, work.Branch, "agent-1")
	if err := work.Destroy(ctx); err != nil {
		t.Fatal(err)
	}
	got := a.requests()
	same(t, got[0].json(t), map[string]any{"name": "agent-1", "from": "main", "at": "v3"})
	same(t, []string{got[1].method, got[1].path}, []string{"DELETE", "/v2/indexes/products/branches/agent-1"})
}
