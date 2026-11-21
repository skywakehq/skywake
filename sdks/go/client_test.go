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
		failure(404, "not_found", map[string]any{"hint": "did you mean `app`?"}),
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
	_, err = sky.Disk("ap").Info(ctx)
	var missing *skywake.NotFound
	if !errors.As(err, &missing) {
		t.Fatalf("want NotFound, got %v", err)
	}
	if missing.Hint != "did you mean `app`?" || missing.RequestID != "req-1" || missing.Status != 404 {
		t.Fatalf("fields: %+v", missing)
	}
	if !strings.Contains(err.Error(), "did you mean `app`?") {
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
		return failure(409, "conflict", map[string]any{"conflicts": []string{"README.md"}})
	})
	_, err := a.sky(t).Disk("app", "agent-1").MergeInto(ctx, "")
	var merge *skywake.MergeConflict
	if !errors.As(err, &merge) {
		t.Fatalf("want MergeConflict, got %v", err)
	}
	same(t, merge.Conflicts, []string{"README.md"})
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
	for disk, err := range a.sky(t).ListDisks(ctx) {
		if err != nil {
			t.Fatal(err)
		}
		names = append(names, disk.Name)
	}
	same(t, names, []string{"a", "b", "c"})
}

func TestQueryTakesTextFirstAndOptionsOnTheirOwn(t *testing.T) {
	a := fake(t, func(seen, int) reply {
		return reply{body: map[string]any{"data": []any{map[string]any{"path": "docs/coffee.md", "score": 0.9}}, "next": nil}}
	})
	app := a.sky(t).Disk("app", "draft")
	hits := must(app.Query(ctx, "coffee", skywake.SearchOptions{Limit: 3, Path: "docs"}))
	same(t, hits[0].Path, "docs/coffee.md")
	same(t, a.requests()[0].path, "/v2/disks/app/query")
	same(t, a.requests()[0].json(t), map[string]any{"text": "coffee", "limit": 3, "path": "docs", "branch": "draft"})
}

func TestFilesAreReadAndWrittenByPathEachPartOfItEncoded(t *testing.T) {
	a := fake(t, func(s seen, _ int) reply {
		if s.method == "GET" {
			return reply{raw: []byte("hello")}
		}
		return reply{body: map[string]any{"commit": "c1", "changed": true}}
	})
	app := a.sky(t).Disk("app")
	same(t, must(app.Read(ctx, "/docs/a b.md", skywake.ReadOptions{At: "c0"})), "hello")
	same(t, must(app.ReadBytes(ctx, "x")), []byte("hello"))
	must(app.WriteFiles(ctx, map[string][]byte{"a.md": []byte("one"), "b.bin": {0xff, 0x00}}, skywake.WriteOptions{Message: "two"}))
	got := a.requests()
	same(t, got[0].path, "/v2/disks/app/files/docs/a%20b.md")
	same(t, got[0].query.Get("at"), "c0")
	same(t, got[2].json(t), map[string]any{
		"message": "two",
		"branch":  "main",
		"changes": []any{
			map[string]any{"path": "a.md", "text": "one"},
			map[string]any{"path": "b.bin", "base64": "/wA="},
		},
	})
}

func TestALargeFileGoesUpInPartsBeforeItsCommit(t *testing.T) {
	a := fake(t, func(s seen, _ int) reply {
		if strings.HasSuffix(s.path, "/uploads") {
			return reply{status: 201, body: map[string]any{"part": fmt.Sprintf("p%d", len(s.body)), "size": len(s.body)}}
		}
		return reply{body: map[string]any{"commit": "c1", "changed": true}}
	})
	must(a.sky(t).Disk("app").Write(ctx, "big.bin", make([]byte, 20*1024*1024)))
	var parts []int
	got := a.requests()
	for _, s := range got {
		if strings.HasSuffix(s.path, "/uploads") {
			parts = append(parts, len(s.body))
			same(t, s.headers.Get("content-type"), "application/octet-stream")
		}
	}
	same(t, parts, []int{16 * 1024 * 1024, 4 * 1024 * 1024})
	commit := got[len(got)-1].json(t).(map[string]any)
	same(t, commit["changes"], []any{
		map[string]any{"path": "big.bin", "parts": []string{fmt.Sprintf("p%d", 16*1024*1024), fmt.Sprintf("p%d", 4*1024*1024)}},
	})
}

func TestAForkIsAHandleOnTheNewBranchAndDestroyRemovesJustTheBranch(t *testing.T) {
	a := fake(t, func(s seen, _ int) reply {
		if s.method == "DELETE" {
			return reply{status: 204}
		}
		return reply{status: 201, body: map[string]any{"name": "agent-1"}}
	})
	work := must(a.sky(t).Disk("app").Fork(ctx, "agent-1", skywake.ForkOptions{At: "c3"}))
	same(t, work.Branch, "agent-1")
	if err := work.Destroy(ctx); err != nil {
		t.Fatal(err)
	}
	got := a.requests()
	same(t, got[0].json(t), map[string]any{"name": "agent-1", "from": "main", "at": "c3"})
	same(t, []string{got[1].method, got[1].path}, []string{"DELETE", "/v2/disks/app/branches/agent-1"})
}

func TestRestoreToATimePicksTheNewestCommitAtOrBeforeIt(t *testing.T) {
	a := fake(t, func(s seen, _ int) reply {
		if s.method == "GET" {
			return reply{body: map[string]any{"data": []any{
				map[string]any{"id": "c3", "message": "", "created": "2026-01-03T00:00:00Z", "merged": nil},
				map[string]any{"id": "c2", "message": "", "created": "2026-01-02T00:00:00Z", "merged": nil},
			}, "next": nil}}
		}
		return reply{body: map[string]any{"commit": "c4", "changed": true}}
	})
	at := time.Date(2026, 1, 2, 12, 0, 0, 0, time.UTC)
	must(a.sky(t).Disk("app").RestoreTo(ctx, at))
	same(t, a.requests()[1].json(t), map[string]any{"to": "c2", "branch": "main"})
}
