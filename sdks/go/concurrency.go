package skywake

import "sync"

const defaultConcurrency = 8

func concurrently[T, R any](items []T, limit int, work func(T) (R, error)) ([]R, error) {
	if limit <= 0 {
		limit = defaultConcurrency
	}
	results := make([]R, len(items))
	errs := make([]error, len(items))
	next := make(chan int)
	var group sync.WaitGroup
	for range min(limit, max(len(items), 1)) {
		group.Add(1)
		go func() {
			defer group.Done()
			for i := range next {
				results[i], errs[i] = work(items[i])
			}
		}()
	}
	for i := range items {
		next <- i
	}
	close(next)
	group.Wait()
	for _, err := range errs {
		if err != nil {
			return nil, err
		}
	}
	return results, nil
}
