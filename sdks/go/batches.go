package skywake

func batches[T any](items []T, maxCount, maxBytes int, weigh func(T) int) [][]T {
	var all [][]T
	var batch []T
	size := 0
	for _, item := range items {
		weight := weigh(item)
		if len(batch) == maxCount || (len(batch) > 0 && size+weight > maxBytes) {
			all = append(all, batch)
			batch, size = nil, 0
		}
		batch = append(batch, item)
		size += weight
	}
	if len(batch) > 0 {
		all = append(all, batch)
	}
	return all
}
