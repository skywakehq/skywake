package skywake

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
)

type params map[string]string

func (p params) with(name, value string) params {
	out := params{name: value}
	for k, v := range p {
		out[k] = v
	}
	return out
}

type call struct {
	method string
	path   string
	query  params
	json   any
}

type transport struct {
	base    string
	headers http.Header
	retrier retrier
}

func newTransport(c config) *transport {
	headers := http.Header{}
	headers.Set("authorization", "Bearer "+c.key)
	if c.environment != "" {
		headers.Set("skywake-environment", c.environment)
	}
	client := c.httpClient
	if client == nil {
		pool := http.DefaultTransport.(*http.Transport).Clone()
		pool.ResponseHeaderTimeout = c.timeout
		client = &http.Client{Transport: pool}
	}
	return &transport{
		base:    c.url + "/v2",
		headers: headers,
		retrier: retrier{client: client, retries: c.retries, backoff: c.backoff},
	}
}

func (t *transport) in(environment string) *transport {
	headers := t.headers.Clone()
	headers.Set("skywake-environment", environment)
	return &transport{base: t.base, headers: headers, retrier: t.retrier}
}

func segment(name string) string { return url.PathEscape(name) }

func (t *transport) address(c call) string {
	query := url.Values{}
	for name, value := range c.query {
		if value != "" {
			query.Set(name, value)
		}
	}
	address := t.base + c.path
	if len(query) > 0 {
		address += "?" + query.Encode()
	}
	return address
}

func (t *transport) open(ctx context.Context, c call) (*http.Response, error) {
	var body []byte
	if c.json != nil {
		encoded, err := json.Marshal(c.json)
		if err != nil {
			return nil, err
		}
		body = encoded
	}
	address := t.address(c)
	response, err := t.retrier.send(ctx, func() (*http.Request, error) {
		var reader io.Reader
		if body != nil {
			reader = bytes.NewReader(body)
		}
		request, err := http.NewRequestWithContext(ctx, c.method, address, reader)
		if err != nil {
			return nil, err
		}
		request.Header = t.headers.Clone()
		if body != nil {
			request.Header.Set("content-type", "application/json")
		}
		return request, nil
	})
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 300 {
		return response, nil
	}
	defer response.Body.Close()
	raw, _ := io.ReadAll(response.Body)
	return nil, errorOf(response, raw)
}

func (t *transport) do(ctx context.Context, c call, out any) error {
	response, err := t.open(ctx, c)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil || out == nil || len(raw) == 0 {
		return err
	}
	return json.Unmarshal(raw, out)
}

func (t *transport) get(ctx context.Context, path string, query params, out any) error {
	return t.do(ctx, call{method: http.MethodGet, path: path, query: query}, out)
}

func (t *transport) post(ctx context.Context, path string, body any, query params, out any) error {
	return t.do(ctx, call{method: http.MethodPost, path: path, json: body, query: query}, out)
}

func (t *transport) patch(ctx context.Context, path string, body any, query params, out any) error {
	return t.do(ctx, call{method: http.MethodPatch, path: path, json: body, query: query}, out)
}

func (t *transport) delete(ctx context.Context, path string) error {
	return t.do(ctx, call{method: http.MethodDelete, path: path}, nil)
}
