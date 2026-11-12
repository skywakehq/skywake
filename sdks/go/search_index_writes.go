package skywake

import "context"

// batch is the most documents or ids the API takes in one request.
const batch = 1000

// batched sends items to a route of the branch 1000 at a time and sums
// what each answer counts.
func batched[T any](ctx context.Context, items []T, send func(context.Context, []T) (int, error)) (int, error) {
	total := 0
	for start := 0; start < len(items); start += batch {
		n, err := send(ctx, items[start:min(start+batch, len(items))])
		if err != nil {
			return total, err
		}
		total += n
	}
	return total, nil
}

// written sends a batch to a route that answers how many it wrote.
func (s *SearchIndex) written(ctx context.Context, route string, body any) (int, error) {
	answer, err := post[struct{ Count int }](ctx, s, route, body)
	return answer.Count, err
}

// Upsert writes documents, 1000 to a request. Each replaces any earlier
// one with its id. It returns how many were written.
func (s *SearchIndex) Upsert(ctx context.Context, docs []Document) (int, error) {
	return batched(ctx, docs, func(ctx context.Context, part []Document) (int, error) {
		return s.written(ctx, "documents", map[string]any{"documents": part})
	})
}

// Delete deletes documents by id, 1000 to a request. Ids that are not
// there are ignored.
func (s *SearchIndex) Delete(ctx context.Context, ids []DocID) (int, error) {
	return batched(ctx, ids, func(ctx context.Context, part []DocID) (int, error) {
		return s.written(ctx, "documents/delete", map[string]any{"ids": part})
	})
}

// Write applies upserts, patches and deletes as one change.
func (s *SearchIndex) Write(ctx context.Context, w Write) (*WriteCounts, error) {
	counts, err := post[WriteCounts](ctx, s, "write", w)
	return &counts, err
}

// Patch sets attributes of documents, 1000 to a request; a nil value
// removes one. Missing documents are skipped. It returns how many were patched.
func (s *SearchIndex) Patch(ctx context.Context, patches []Patch) (int, error) {
	return batched(ctx, patches, func(ctx context.Context, part []Patch) (int, error) {
		counts, err := s.Write(ctx, Write{Patches: part})
		if err != nil {
			return 0, err
		}
		return counts.Patched, nil
	})
}

// DeleteBy deletes every document that passes filter and returns how many.
func (s *SearchIndex) DeleteBy(ctx context.Context, filter any) (int, error) {
	counts, err := s.Write(ctx, Write{DeleteBy: filter})
	if err != nil {
		return 0, err
	}
	return counts.Deleted, nil
}
