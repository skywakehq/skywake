package skywake

import (
	"context"
	"iter"
)

// SearchIndex is one branch of a search index: main unless At picked another.
type SearchIndex struct {
	Name   string
	Branch string
	c      *Client
}

// At is the same index on another branch.
func (s *SearchIndex) At(branch string) *SearchIndex {
	return &SearchIndex{c: s.c, Name: s.Name, Branch: branch}
}

func (s *SearchIndex) path() string {
	return "/indexes/" + escape(s.Name)
}

func (s *SearchIndex) branchPath() string {
	return s.path() + "/branches/" + escape(s.Branch)
}

// post sends body to a route of this branch and returns the decoded answer.
func post[T any](ctx context.Context, s *SearchIndex, route string, body any) (T, error) {
	return fetch[T](ctx, s.c, "POST", s.branchPath()+"/"+route, nil, body)
}

// Fork forks this branch as name. Nothing is copied.
func (s *SearchIndex) Fork(ctx context.Context, name string) (*SearchIndex, error) {
	return s.fork(ctx, map[string]string{"name": name, "from": s.Branch})
}

// ForkAt forks this branch as name at an older version of it. Nothing is copied.
func (s *SearchIndex) ForkAt(ctx context.Context, name, version string) (*SearchIndex, error) {
	return s.fork(ctx, map[string]string{"name": name, "from": s.Branch, "at": version})
}

func (s *SearchIndex) fork(ctx context.Context, body map[string]string) (*SearchIndex, error) {
	if err := s.c.call(ctx, "POST", s.path()+"/branches", nil, body, nil); err != nil {
		return nil, err
	}
	return s.At(body["name"]), nil
}

// Branches returns one page of the index's branches, in name order.
func (s *SearchIndex) Branches(ctx context.Context, limit int, after string) ([]Branch, error) {
	return fetch[[]Branch](ctx, s.c, "GET", s.path()+"/branches", page(limit, after), nil)
}

// AllBranches yields every branch, a page at a time.
func (s *SearchIndex) AllBranches(ctx context.Context) iter.Seq2[Branch, error] {
	return every(ctx, s.Branches, func(b Branch) string { return b.Name })
}

// DeleteBranch deletes this branch. main stays while the index does.
func (s *SearchIndex) DeleteBranch(ctx context.Context) error {
	return s.c.call(ctx, "DELETE", s.branchPath(), nil, nil, nil)
}

// Versions returns one page of this branch's versions, newest first: one
// for every change. A limit of 0 is 20.
func (s *SearchIndex) Versions(ctx context.Context, limit int, after string) ([]Version, error) {
	return fetch[[]Version](ctx, s.c, "GET", s.branchPath()+"/versions", page(limit, after), nil)
}

// Restore moves this branch back to an older version, as a new version,
// which it returns. The history stays.
func (s *SearchIndex) Restore(ctx context.Context, version string) (*Version, error) {
	body := map[string]string{"version": version}
	restored, err := post[Version](ctx, s, "restore", body)
	return &restored, err
}

// Merge adds the writes of branch since it forked, or was last merged
// here, to this branch, and returns how many rows it added. Where both
// wrote one document, branch's write wins.
func (s *SearchIndex) Merge(ctx context.Context, branch string) (int, error) {
	body := map[string]string{"from": branch}
	merged, err := post[struct{ Rows int }](ctx, s, "merge", body)
	return merged.Rows, err
}

// Copy copies this branch to a new index, as its main.
func (s *SearchIndex) Copy(ctx context.Context, to CopyIndex) (*SearchIndex, error) {
	body := struct {
		CopyIndex
		Branch string `json:"branch"`
	}{to, s.Branch}
	if err := s.c.call(ctx, "POST", s.path()+"/copy", nil, body, nil); err != nil {
		return nil, err
	}
	return s.c.Index(to.Name), nil
}
