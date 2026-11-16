package skywake

import (
	"net/http"
	"time"
)

type Option func(*config)

type config struct {
	key         string
	url         string
	environment string
	profile     string
	retries     int
	backoff     time.Duration
	timeout     time.Duration
	httpClient  *http.Client
}

func defaults() config {
	return config{retries: 3, backoff: 200 * time.Millisecond, timeout: 60 * time.Second}
}

func WithKey(key string) Option { return func(c *config) { c.key = key } }

func WithURL(url string) Option { return func(c *config) { c.url = url } }

func WithEnvironment(name string) Option { return func(c *config) { c.environment = name } }

func WithProfile(name string) Option { return func(c *config) { c.profile = name } }

func WithRetries(retries int) Option { return func(c *config) { c.retries = retries } }

func WithBackoff(base time.Duration) Option { return func(c *config) { c.backoff = base } }

func WithTimeout(timeout time.Duration) Option { return func(c *config) { c.timeout = timeout } }

func WithHTTPClient(client *http.Client) Option { return func(c *config) { c.httpClient = client } }

func first[T any](options []T) T {
	var zero T
	if len(options) == 0 {
		return zero
	}
	return options[0]
}
