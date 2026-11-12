package skywake

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client talks to the API. Change its fields before the first request.
type Client struct {
	// HTTP sends the requests. Its default waits up to 60 seconds to
	// connect and then for the answer to start, but never cuts off an
	// answer that keeps arriving, such as an export.
	HTTP *http.Client
	// Retries is how many more times a failed request is tried when that
	// is safe: after a 429 always, and after a network error or a 5xx for
	// GET, PUT and DELETE.
	Retries int
	// Backoff is about how long the first retry waits, doubled each time,
	// unless the server asks for a wait of its own.
	Backoff time.Duration
	// Indexes makes, lists, reads and deletes search indexes.
	Indexes Indexes

	base string
	key  string
}

// New returns a client of the API at url, with an API key (sw_...) or a
// console token.
func New(baseURL, key string) *Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{Timeout: 60 * time.Second}).DialContext
	transport.ResponseHeaderTimeout = 60 * time.Second
	c := &Client{
		HTTP:    &http.Client{Transport: transport},
		Retries: 3,
		Backoff: 200 * time.Millisecond,
		// Every route lives under /v1.
		base: strings.TrimSuffix(strings.TrimRight(baseURL, "/"), "/v1") + "/v1",
		key:  key,
	}
	c.Indexes = Indexes{c}
	return c
}

// Index is a search index, on its main branch.
func (c *Client) Index(name string) *SearchIndex {
	return &SearchIndex{c: c, Name: name, Branch: "main"}
}

// call sends a request and decodes its answer into out, unless out is nil.
func (c *Client) call(ctx context.Context, method, path string, query url.Values, body, out any) error {
	resp, err := c.send(ctx, method, path, query, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if err := check(resp); err != nil {
		return err
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// fetch sends a request and returns its decoded answer.
func fetch[T any](ctx context.Context, c *Client, method, path string, query url.Values, body any) (T, error) {
	var out T
	err := c.call(ctx, method, path, query, body, &out)
	return out, err
}

// escape keeps a name whole in a URL: index and branch names may hold /.
func escape(name string) string {
	return url.PathEscape(name)
}
