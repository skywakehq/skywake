package skywake

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"math/rand/v2"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// The server asks for at most 60 seconds; waiting less would only be refused again.
const maxWait = 60 * time.Second

// Sending these again has the same effect as sending them once.
var idempotent = map[string]bool{"GET": true, "HEAD": true, "PUT": true, "DELETE": true, "OPTIONS": true}

// send sends a request, and again when that is safe (see Retries). A
// DELETE that failed may still have landed, so if a retry of it then finds
// nothing (404), it answers 204: what it deleted is gone either way.
func (c *Client) send(ctx context.Context, method, path string, query url.Values, body any) (*http.Response, error) {
	var payload []byte
	if body != nil {
		var err error
		if payload, err = json.Marshal(body); err != nil {
			return nil, err
		}
	}
	target := c.base + path
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	mayHaveLanded := false
	for attempt := 0; ; attempt++ {
		last := attempt >= c.Retries
		var reader io.Reader
		if payload != nil {
			reader = bytes.NewReader(payload)
		}
		req, err := http.NewRequestWithContext(ctx, method, target, reader)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+c.key)
		if payload != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := c.HTTP.Do(req)
		if err != nil {
			if last || !idempotent[method] || ctx.Err() != nil {
				return nil, err
			}
			mayHaveLanded = true
			if err := sleep(ctx, c.backoff(attempt)); err != nil {
				return nil, err
			}
			continue
		}
		if mayHaveLanded && method == http.MethodDelete && resp.StatusCode == http.StatusNotFound {
			resp.Body.Close()
			return &http.Response{StatusCode: http.StatusNoContent, Header: http.Header{}, Body: http.NoBody, Request: req}, nil
		}
		again := resp.StatusCode == http.StatusTooManyRequests || (idempotent[method] && resp.StatusCode >= 500)
		if last || !again {
			return resp, nil
		}
		mayHaveLanded = mayHaveLanded || resp.StatusCode >= 500
		wait := retryAfter(resp)
		if wait == 0 {
			wait = c.backoff(attempt)
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if err := sleep(ctx, min(wait, maxWait)); err != nil {
			return nil, err
		}
	}
}

// backoff has full jitter, so many clients that failed together do not
// retry together.
func (c *Client) backoff(attempt int) time.Duration {
	ceiling := min(maxWait, c.Backoff<<attempt)
	if ceiling <= 0 {
		ceiling = maxWait
	}
	return time.Duration(rand.Int64N(int64(ceiling) + 1))
}

func retryAfter(resp *http.Response) time.Duration {
	seconds, err := strconv.ParseFloat(resp.Header.Get("Retry-After"), 64)
	if err != nil || seconds <= 0 {
		return 0
	}
	return time.Duration(seconds * float64(time.Second))
}

func sleep(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
