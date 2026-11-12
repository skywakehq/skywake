package skywake

import "context"

// Build starts clustering this branch's rows. It answers before the build
// ends, with an operation Operation follows.
func (s *SearchIndex) Build(ctx context.Context) (*Operation, error) {
	op, err := post[Operation](ctx, s, "build", nil)
	return &op, err
}

// Warm starts reading this branch into the cache, so the next queries are fast.
func (s *SearchIndex) Warm(ctx context.Context) (*Operation, error) {
	op, err := post[Operation](ctx, s, "warm", nil)
	return &op, err
}

// Operation returns a build or warming of this index, and how it went.
func (s *SearchIndex) Operation(ctx context.Context, id string) (*Operation, error) {
	op, err := fetch[Operation](ctx, s.c, "GET", s.path()+"/operations/"+escape(id), nil, nil)
	return &op, err
}

// Collect starts deleting the data of the whole index that no branch
// uses, nor any version within its retention, with an operation
// Operation follows.
func (s *SearchIndex) Collect(ctx context.Context) (*Operation, error) {
	op, err := fetch[Operation](ctx, s.c, "POST", s.path()+"/collect", nil, nil)
	return &op, err
}

// Stats returns this branch's counts, or nil while the server cannot count them.
func (s *SearchIndex) Stats(ctx context.Context) (*Stats, error) {
	branch, err := fetch[struct{ Stats *Stats }](ctx, s.c, "GET", s.branchPath(), nil, nil)
	return branch.Stats, err
}

// Recall queries with the vectors of documents picked at random, as asked
// and exactly, and compares them.
func (s *SearchIndex) Recall(ctx context.Context, check RecallCheck) (*Recall, error) {
	recall, err := post[Recall](ctx, s, "recall", check)
	return &recall, err
}
