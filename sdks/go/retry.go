package skywake

import (
	"context"
	"io"
	"math/rand/v2"
	"net/http"
	"time"
)

const maxWait = 60 * time.Second

var idempotent = map[string]bool{
	http.MethodGet: true, http.MethodHead: true, http.MethodPut: true,
	http.MethodDelete: true, http.MethodOptions: true,
}

type retrier struct {
	client  *http.Client
	retries int
	backoff time.Duration
}

func (r retrier) send(ctx context.Context, build func() (*http.Request, error)) (*http.Response, error) {
	landed := false
	for attempt := 0; ; attempt++ {
		last := attempt >= r.retries
		request, err := build()
		if err != nil {
			return nil, err
		}
		safe := idempotent[request.Method]
		response, err := r.client.Do(request)
		if err != nil {
			if last || !safe || ctx.Err() != nil {
				return nil, err
			}
			landed = true
			if err := sleep(ctx, r.wait(attempt)); err != nil {
				return nil, err
			}
			continue
		}
		if landed && request.Method == http.MethodDelete && response.StatusCode == http.StatusNotFound {
			discard(response)
			return &http.Response{StatusCode: http.StatusNoContent, Header: http.Header{}, Body: http.NoBody}, nil
		}
		again := response.StatusCode == http.StatusTooManyRequests || (safe && response.StatusCode >= 500)
		if last || !again {
			return response, nil
		}
		landed = landed || response.StatusCode >= 500
		wait := retryAfter(response.Header)
		if wait == 0 {
			wait = r.wait(attempt)
		}
		discard(response)
		if err := sleep(ctx, min(wait, maxWait)); err != nil {
			return nil, err
		}
	}
}

func (r retrier) wait(attempt int) time.Duration {
	ceiling := min(maxWait, r.backoff<<min(attempt, 30))
	if ceiling <= 0 {
		return 0
	}
	return time.Duration(rand.Int64N(int64(ceiling)))
}

func discard(response *http.Response) {
	io.Copy(io.Discard, response.Body)
	response.Body.Close()
}

func sleep(ctx context.Context, wait time.Duration) error {
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
