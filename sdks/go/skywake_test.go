package skywake

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

// seen is a request the fake API got.
type seen struct {
	method, path, query string
	body                any
}

// fake runs an API that answers with answer and records each request.
func fake(t *testing.T, answer func(seen, http.ResponseWriter)) (*Client, *[]seen) {
	t.Helper()
	var (
		mu  sync.Mutex
		got []seen
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sw_key" {
			t.Errorf("no key on %s", r.URL)
		}
		s := seen{method: r.Method, path: r.URL.EscapedPath(), query: r.URL.RawQuery}
		json.NewDecoder(r.Body).Decode(&s.body)
		mu.Lock()
		got = append(got, s)
		mu.Unlock()
		answer(s, w)
	}))
	t.Cleanup(server.Close)
	c := New(server.URL+"/v1/", "sw_key")
	c.Backoff = time.Millisecond
	return c, &got
}

func reply(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}

func same(t *testing.T, got, want any) {
	t.Helper()
	// Through JSON, so numbers and maps compare as the wire has them.
	normal := func(v any) any {
		var out any
		data, _ := json.Marshal(v)
		json.Unmarshal(data, &out)
		return out
	}
	if !reflect.DeepEqual(normal(got), normal(want)) {
		t.Fatalf("got %v\nwant %v", normal(got), normal(want))
	}
}

func TestAnUpsertIsSent1000DocumentsAtATimeToTheBranchPicked(t *testing.T) {
	c, got := fake(t, func(s seen, w http.ResponseWriter) {
		docs := s.body.(map[string]any)["documents"].([]any)
		reply(w, 200, map[string]any{"count": len(docs)})
	})
	docs := make([]Document, 2500)
	for i := range docs {
		docs[i] = Document{ID: i, Vectors: map[string]any{"v": []float32{float32(i), 0}}}
	}
	n, err := c.Index("prod/products").At("agents/try").Upsert(context.Background(), docs)
	if err != nil || n != 2500 {
		t.Fatal(n, err)
	}
	var sizes []int
	for _, s := range *got {
		if s.path != "/v1/indexes/prod%2Fproducts/branches/agents%2Ftry/documents" {
			t.Fatal(s.path)
		}
		sizes = append(sizes, len(s.body.(map[string]any)["documents"].([]any)))
	}
	same(t, sizes, []int{1000, 1000, 500})
}

func TestAQuerySendsOnlyWhatIsGivenAndGivesPerformance(t *testing.T) {
	answer := map[string]any{
		"hits":        []any{map[string]any{"id": "a", "distance": 0.1, "attributes": map[string]any{}}},
		"performance": map[string]any{"server_ms": 3, "cache_temperature": "warm", "cache_hit_ratio": 0.5},
		"billing":     map[string]any{"queries": 1},
	}
	c, got := fake(t, func(_ seen, w http.ResponseWriter) { reply(w, 200, answer) })
	filter := map[string]any{"tag": map[string]any{"eq": "billing"}}
	hits, err := c.Index("products").Query(context.Background(), Query{
		Vector: Vector{Column: "embedding", Value: []float32{0.5, 0.25}},
		TopK:   5,
		Filter: filter,
	})
	if err != nil {
		t.Fatal(err)
	}
	same(t, (*got)[0].body, map[string]any{
		"vector": map[string]any{"column": "embedding", "value": []float64{0.5, 0.25}},
		"topK":   5,
		"filter": filter,
	})
	if (*got)[0].path != "/v1/indexes/products/branches/main/query" {
		t.Fatal((*got)[0].path)
	}
	if hits.Items[0].ID != "a" || hits.Performance.CacheTemperature != "warm" || hits.Billing.Queries != 1 {
		t.Fatalf("%+v", hits)
	}
}

func TestAnAttributeSendsItsTextOptionsAndFilterIndex(t *testing.T) {
	c, got := fake(t, func(_ seen, w http.ResponseWriter) { reply(w, 201, map[string]any{}) })
	_, err := c.Indexes.Create(context.Background(), NewIndex{
		Name: "docs",
		Schema: Schema{Attributes: []Attribute{
			{Name: "body", Type: "text", Language: "french", Stopwords: true},
			{Name: "tag", Type: "string", FilterIndex: true},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	same(t, (*got)[0].body, map[string]any{
		"name": "docs",
		"schema": map[string]any{
			"vectors": nil,
			"attributes": []any{
				map[string]any{"name": "body", "type": "text", "language": "french", "stopwords": true},
				map[string]any{"name": "tag", "type": "string", "filter_index": true},
			},
		},
	})
}

func TestA429IsRetriedAsAskedButAFailedPostIsNot(t *testing.T) {
	tries := 0
	c, got := fake(t, func(s seen, w http.ResponseWriter) {
		if s.path == "/v1/indexes/x/branches/main/write" {
			reply(w, 503, map[string]any{"error": "down"})
			return
		}
		if tries++; tries < 3 {
			w.Header().Set("Retry-After", "0.01")
			reply(w, 429, map[string]any{"error": "slow down", "code": "rate_limited"})
			return
		}
		reply(w, 200, map[string]any{"rows": []any{}})
	})
	ctx := context.Background()
	if _, err := c.Index("x").Order(ctx, Order{By: "id"}); err != nil {
		t.Fatal(err)
	}
	if len(*got) != 3 {
		t.Fatal(len(*got))
	}
	_, err := c.Index("x").Write(ctx, Write{Deletes: []DocID{1}})
	var e *Error
	if !errors.As(err, &e) || e.Status != 503 || len(*got) != 4 {
		t.Fatal(err, len(*got))
	}
}

func TestADeleteRetriedAfterAFailureCountsANotFoundAsDone(t *testing.T) {
	tries := 0
	c, got := fake(t, func(_ seen, w http.ResponseWriter) {
		// The first try may have deleted it before failing; the retry finds nothing.
		if tries++; tries == 1 {
			reply(w, 502, map[string]any{"error": "bad gateway"})
			return
		}
		reply(w, 404, map[string]any{"error": "no such branch"})
	})
	if err := c.Index("x").At("old").DeleteBranch(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(*got) != 2 || (*got)[1].method != "DELETE" {
		t.Fatal(*got)
	}
}

func TestAnErrorSaysWhatWasWrongAndWhere(t *testing.T) {
	c, got := fake(t, func(_ seen, w http.ResponseWriter) {
		reply(w, 400, map[string]any{
			"error":      "must be a number",
			"code":       "invalid",
			"request_id": "req-1",
			"path":       "filter.price.lt",
		})
	})
	_, err := c.Index("products").Search(context.Background(), Search{Query: "x"})
	var e *Error
	if !errors.As(err, &e) {
		t.Fatal(err)
	}
	same(t, []any{e.Status, e.Message, e.Code, e.RequestID, e.Path},
		[]any{400, "must be a number", "invalid", "req-1", "filter.price.lt"})
	if len(*got) != 1 {
		t.Fatal("a 4xx is not retried")
	}
}

func TestRankAndMultiGiveTheirHitsAndBilling(t *testing.T) {
	c, got := fake(t, func(s seen, w http.ResponseWriter) {
		ranked := []any{map[string]any{"id": 2, "score": 6, "attributes": map[string]any{}}}
		if s.path == "/v1/indexes/docs/branches/main/rank" {
			reply(w, 200, map[string]any{"hits": ranked, "billing": map[string]any{"queries": 1}})
			return
		}
		results := []any{map[string]any{"rank": ranked}, map[string]any{"aggregate": []any{}}}
		reply(w, 200, map[string]any{"results": results, "billing": map[string]any{"queries": 2}})
	})
	ctx := context.Background()
	score := map[string]any{"dot": map[string]any{"attribute": "terms", "indices": []int{2}, "values": []float64{3}}}
	hits, err := c.Index("docs").Rank(ctx, Rank{Score: score, TopK: 3})
	if err != nil || hits.Items[0].Score != 6 || hits.Billing.Queries != 1 {
		t.Fatal(hits, err)
	}
	same(t, (*got)[0].body, map[string]any{"score": score, "topK": 3})
	requests := []MultiRequest{{Rank: &Rank{Score: score}}, {Aggregate: &Aggregate{Measures: map[string][]string{"n": {"count"}}}}}
	results, err := c.Index("docs").Multi(ctx, requests, "eventual")
	if err != nil || results.Items[0].Rank[0].ID != 2.0 || results.Billing.Queries != 2 {
		t.Fatal(results, err)
	}
	same(t, (*got)[1].body, map[string]any{
		"requests":    []any{map[string]any{"rank": map[string]any{"score": score}}, map[string]any{"aggregate": map[string]any{"measures": map[string]any{"n": []string{"count"}}}}},
		"consistency": "eventual",
	})
}

func TestAnExportIsReadOneDocumentAtATime(t *testing.T) {
	c, _ := fake(t, func(_ seen, w http.ResponseWriter) {
		fmt.Fprint(w, "{\"id\":1,\"vectors\":{\"v\":[1]}}\n\n{\"id\":\"b\",\"attributes\":{\"n\":2}}\n")
	})
	var ids []any
	for doc, err := range c.Index("x").Export(context.Background()) {
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, doc.ID)
	}
	same(t, ids, []any{1, "b"})
}

func TestEveryBranchIsReadAPageAtATime(t *testing.T) {
	names := make([]map[string]any, 1001)
	for i := range names {
		names[i] = map[string]any{"name": fmt.Sprintf("b%04d", i), "forked_from": "main", "created": ""}
	}
	c, got := fake(t, func(s seen, w http.ResponseWriter) {
		if s.query == "limit=1000" {
			reply(w, 200, names[:1000])
			return
		}
		reply(w, 200, names[1000:])
	})
	count := 0
	for _, err := range c.Index("x").AllBranches(context.Background()) {
		if err != nil {
			t.Fatal(err)
		}
		count++
	}
	if count != 1001 || (*got)[1].query != "after=b0999&limit=1000" {
		t.Fatal(count, *got)
	}
}

func TestReadsOfOneValueGoToTheirRoutes(t *testing.T) {
	c, got := fake(t, func(s seen, w http.ResponseWriter) {
		switch s.path {
		case "/v1/indexes/x/branches/a%2Fb":
			reply(w, 200, map[string]any{"name": "a/b", "stats": map[string]any{"rows": 7}})
		case "/v1/indexes/x/branches/main/merge":
			reply(w, 200, map[string]any{"rows": 2})
		default:
			reply(w, 202, map[string]any{"id": "op_1", "status": "running"})
		}
	})
	ctx := context.Background()
	stats, err := c.Index("x").At("a/b").Stats(ctx)
	if err != nil || stats.Rows != 7 {
		t.Fatal(stats, err)
	}
	rows, err := c.Index("x").Merge(ctx, "a/b")
	if err != nil || rows != 2 {
		t.Fatal(rows, err)
	}
	op, err := c.Index("x").Build(ctx)
	if err != nil || op.ID != "op_1" {
		t.Fatal(op, err)
	}
	same(t, (*got)[1].body, map[string]any{"from": "a/b"})
}

func TestAWriteAsksForTheIDsItChangedAndAnIndexMayTakeUUIDs(t *testing.T) {
	c, got := fake(t, func(s seen, w http.ResponseWriter) {
		if s.path == "/v1/indexes" {
			reply(w, 201, map[string]any{"name": "b"})
			return
		}
		reply(w, 200, map[string]any{"upserted": 0, "patched": 0, "deleted": 1, "deleted_ids": []any{"a"}})
	})
	ctx := context.Background()
	counts, err := c.Index("a").Write(ctx, Write{Deletes: []DocID{"a"}, ReturnAffectedIDs: true})
	if err != nil || len(counts.DeletedIDs) != 1 || counts.DeletedIDs[0] != "a" {
		t.Fatal(counts, err)
	}
	same(t, (*got)[0].body, map[string]any{"deletes": []any{"a"}, "returnAffectedIds": true})
	schema := Schema{Vectors: []VectorColumn{{Name: "v", Dims: 1}}, Attributes: []Attribute{}, ID: "uuid"}
	if _, err := c.Indexes.Create(ctx, NewIndex{Name: "b", Schema: schema}); err != nil {
		t.Fatal(err)
	}
	same(t, (*got)[1].body, map[string]any{"name": "b", "schema": map[string]any{
		"vectors": []any{map[string]any{"name": "v", "dims": 1}}, "attributes": []any{}, "id": "uuid",
	}})
}

func TestVersionsRestoreForkAtCollectAndParquetGoToTheirRoutes(t *testing.T) {
	version := strings.Repeat("a", 64)
	c, got := fake(t, func(s seen, w http.ResponseWriter) {
		switch {
		case strings.HasSuffix(s.path, "/versions"):
			reply(w, 200, []Version{{Version: version, Rows: 1}})
		case strings.HasSuffix(s.path, "/restore"):
			reply(w, 200, Version{Version: version, Rows: 1})
		case strings.HasSuffix(s.path, "/collect"):
			reply(w, 202, Operation{ID: "op_2", Kind: "collect"})
		case strings.HasSuffix(s.path, "/export"):
			fmt.Fprint(w, "PAR1")
		default:
			reply(w, 201, map[string]any{})
		}
	})
	ctx := context.Background()
	main := c.Index("products")
	versions, err := main.Versions(ctx, 5, version)
	if err != nil || versions[0].Rows != 1 {
		t.Fatal(versions, err)
	}
	if restored, err := main.Restore(ctx, version); err != nil || restored.Version != version {
		t.Fatal(restored, err)
	}
	if fork, err := main.ForkAt(ctx, "past", version); err != nil || fork.Branch != "past" {
		t.Fatal(fork, err)
	}
	if op, err := main.Collect(ctx); err != nil || op.ID != "op_2" {
		t.Fatal(op, err)
	}
	file, err := main.ExportParquet(ctx)
	if err != nil {
		t.Fatal(err)
	}
	bytes, _ := io.ReadAll(file)
	file.Close()
	same(t, string(bytes), "PAR1")
	keep := 7
	if _, err := c.Indexes.Update(ctx, "products", UpdateIndex{RetentionDays: &keep}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Indexes.Update(ctx, "products", UpdateIndex{KeepAllVersions: true}); err != nil {
		t.Fatal(err)
	}
	var routes []string
	for _, s := range *got {
		routes = append(routes, s.method+" "+s.path+"?"+s.query)
	}
	same(t, routes, []string{
		"GET /v1/indexes/products/branches/main/versions?after=" + version + "&limit=5",
		"POST /v1/indexes/products/branches/main/restore?",
		"POST /v1/indexes/products/branches?",
		"POST /v1/indexes/products/collect?",
		"GET /v1/indexes/products/branches/main/export?format=parquet",
		"PATCH /v1/indexes/products?",
		"PATCH /v1/indexes/products?",
	})
	same(t, (*got)[1].body, map[string]any{"version": version})
	same(t, (*got)[2].body, map[string]any{"name": "past", "from": "main", "at": version})
	same(t, (*got)[5].body, map[string]any{"retention_days": 7})
	same(t, (*got)[6].body, map[string]any{"retention_days": nil})
}

func TestAnIndexIsPinnedUnpinnedAndSaysWhere(t *testing.T) {
	pinning := map[string]any{"replicas": []any{map[string]any{"server": "api-1", "warm": true, "in_flight": 2}}}
	c, got := fake(t, func(s seen, w http.ResponseWriter) {
		reply(w, 200, map[string]any{"name": "a", "pinned": map[string]any{"replicas": 1}, "pinning": pinning})
	})
	ctx := context.Background()
	schema := Schema{Vectors: []VectorColumn{{Name: "v", Dims: 3}}}
	if _, err := c.Indexes.Create(ctx, NewIndex{Name: "a", Schema: schema, Pinned: &Pinned{Replicas: 2}}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Indexes.Update(ctx, "a", UpdateIndex{Pinned: &Pinned{Replicas: 3}}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Indexes.Update(ctx, "a", UpdateIndex{Unpin: true, KeepAllVersions: true}); err != nil {
		t.Fatal(err)
	}
	index, err := c.Indexes.Get(ctx, "a")
	if err != nil {
		t.Fatal(err)
	}
	same(t, (*got)[0].body.(map[string]any)["pinned"], map[string]any{"replicas": 2})
	same(t, (*got)[1].body, map[string]any{"pinned": map[string]any{"replicas": 3}})
	same(t, (*got)[2].body, map[string]any{"pinned": nil, "retention_days": nil})
	same(t, index.Pinned, Pinned{Replicas: 1})
	same(t, index.Pinning, pinning)
}

func TestADayWithoutASizeSnapshotHasNoRowsOrBytes(t *testing.T) {
	c, _ := fake(t, func(_ seen, w http.ResponseWriter) {
		reply(w, 200, map[string]any{"days": []any{
			map[string]any{"day": "2026-11-10", "rows": nil, "bytes": nil},
			map[string]any{"day": "2026-11-11", "rows": 3, "bytes": 40},
		}})
	})
	days, err := c.Indexes.Usage(context.Background(), "x", 2)
	if err != nil || days[0].Rows != nil || days[0].Bytes != nil || *days[1].Rows != 3 {
		t.Fatal(days, err)
	}
}
