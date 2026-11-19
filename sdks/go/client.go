package skywake

import (
	"context"
	"iter"
)

const Main = "main"

type Client struct {
	URL         string
	Environment string
	http        *transport
}

func New(options ...Option) (*Client, error) {
	c := defaults()
	for _, option := range options {
		option(&c)
	}
	if err := resolve(&c); err != nil {
		return nil, err
	}
	return &Client{URL: c.url, Environment: c.environment, http: newTransport(c)}, nil
}

func branchOf(branch []string) string {
	return firstSet(first(branch), Main)
}

func (c *Client) Index(name string, branch ...string) *Index {
	return &Index{Name: name, Branch: branchOf(branch), http: c.http}
}

func (c *Client) CreateIndex(ctx context.Context, name string, options ...IndexOptions) (*Index, error) {
	o := first(options)
	body := compact(map[string]any{"name": name, "schema": o.Schema, "region": o.Region, "embed": o.Embed})
	if o.NoEmbed {
		body["embed"] = false
	}
	if err := c.http.post(ctx, "/indexes", body, nil, nil); err != nil {
		return nil, err
	}
	return c.Index(name), nil
}

func (c *Client) ListIndexes(ctx context.Context) iter.Seq2[IndexSummary, error] {
	return listing[IndexSummary](ctx, c.http, "/indexes", nil)
}

func (c *Client) CreateKey(ctx context.Context, key NewKey) (CreatedKey, error) {
	body := compact(map[string]any{"name": key.Name, "role": key.Role, "only": key.Only, "expires_in_days": key.ExpiresInDays})
	body["environment"] = nil
	if key.Environment != "" {
		body["environment"] = key.Environment
	}
	var created CreatedKey
	err := c.http.post(ctx, "/keys", body, nil, &created)
	return created, err
}

func (c *Client) ListKeys(ctx context.Context) iter.Seq2[Key, error] {
	return listing[Key](ctx, c.http, "/keys", nil)
}

func (c *Client) RevokeKey(ctx context.Context, id string) error {
	return c.http.delete(ctx, "/keys/"+segment(id))
}

func (c *Client) ListEnvironments(ctx context.Context) iter.Seq2[Environment, error] {
	return listing[Environment](ctx, c.http, "/environments", nil)
}

func (c *Client) CreateEnvironment(ctx context.Context, name string) (Environment, error) {
	var created Environment
	err := c.http.post(ctx, "/environments", map[string]any{"name": name}, nil, &created)
	return created, err
}

func (c *Client) Whoami(ctx context.Context) (Whoami, error) {
	var me Whoami
	err := c.http.get(ctx, "/whoami", nil, &me)
	return me, err
}
