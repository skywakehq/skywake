package skywake_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"sync"
	"testing"
	"time"

	skywake "github.com/skywakehq/skywake/sdks/go"
)

type seen struct {
	method  string
	path    string
	query   url.Values
	headers http.Header
	body    []byte
}

func (s seen) json(t *testing.T) any {
	t.Helper()
	var out any
	if err := json.Unmarshal(s.body, &out); err != nil {
		t.Fatalf("body of %s %s is not JSON: %v", s.method, s.path, err)
	}
	return out
}

type reply struct {
	status  int
	body    any
	headers map[string]string
	raw     []byte
}

type api struct {
	url  string
	mu   sync.Mutex
	seen []seen
}

func (a *api) requests() []seen {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]seen(nil), a.seen...)
}

func (a *api) sky(t *testing.T, options ...skywake.Option) *skywake.Client {
	t.Helper()
	base := []skywake.Option{skywake.WithURL(a.url), skywake.WithKey("k"), skywake.WithBackoff(time.Millisecond)}
	sky, err := skywake.New(append(base, options...)...)
	if err != nil {
		t.Fatal(err)
	}
	return sky
}

func fake(t *testing.T, handler func(seen, int) reply) *api {
	t.Helper()
	a := &api{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		one := seen{method: r.Method, path: r.URL.EscapedPath(), query: r.URL.Query(), headers: r.Header, body: body}
		a.mu.Lock()
		a.seen = append(a.seen, one)
		count := len(a.seen)
		a.mu.Unlock()
		answer := handler(one, count)
		status := answer.status
		if status == 0 {
			status = http.StatusOK
		}
		if answer.raw != nil {
			w.Header().Set("content-type", "application/octet-stream")
			w.WriteHeader(status)
			w.Write(answer.raw)
			return
		}
		w.Header().Set("content-type", "application/json")
		for name, value := range answer.headers {
			w.Header().Set(name, value)
		}
		w.WriteHeader(status)
		if answer.body != nil {
			json.NewEncoder(w).Encode(answer.body)
		}
	}))
	t.Cleanup(server.Close)
	a.url = server.URL
	return a
}

func failure(status int, code string, extra map[string]any) reply {
	body := map[string]any{"code": code, "message": "nope", "hint": nil, "request_id": "req-1"}
	for name, value := range extra {
		body[name] = value
	}
	return reply{status: status, body: map[string]any{"error": body}}
}

func same(t *testing.T, got, want any) {
	t.Helper()
	normal := func(v any) any {
		var out any
		data, _ := json.Marshal(v)
		json.Unmarshal(data, &out)
		return out
	}
	if !reflect.DeepEqual(normal(got), normal(want)) {
		t.Fatalf("got  %v\nwant %v", normal(got), normal(want))
	}
}

func must[T any](value T, err error) T {
	if err != nil {
		panic(err)
	}
	return value
}
