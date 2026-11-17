package skywake

import (
	"context"
	"fmt"
	"iter"
	"time"
)

func (d *Disk) Fork(ctx context.Context, name string, options ...ForkOptions) (*Disk, error) {
	if err := fork(ctx, d.http, d.path(), name, d.Branch, first(options)); err != nil {
		return nil, err
	}
	return d.On(name), nil
}

func (d *Disk) MergeInto(ctx context.Context, into string, options ...MergeOptions) (Merged, error) {
	body := struct {
		From string `json:"from"`
		Into string `json:"into"`
		MergeOptions
	}{d.Branch, firstSet(into, Main), first(options)}
	var merged Merged
	err := d.http.post(ctx, d.path()+"/merges", body, nil, &merged)
	return merged, err
}

func (d *Disk) Destroy(ctx context.Context) error {
	return destroy(ctx, d.http, d.path(), d.Branch)
}

func (d *Disk) Branches(ctx context.Context) ([]Branch, error) {
	return Collect(listing[Branch](ctx, d.http, d.path()+"/branches", nil))
}

func (d *Disk) Head(ctx context.Context) (string, error) {
	var branch struct{ Head string }
	err := d.http.get(ctx, d.path()+"/branches/"+segment(d.Branch), nil, &branch)
	return branch.Head, err
}

func (d *Disk) Log(ctx context.Context, options ...LogOptions) iter.Seq2[Commit, error] {
	o := first(options)
	query := d.on()
	query["path"] = o.Path
	if o.Limit > 0 {
		query["limit"] = fmt.Sprint(o.Limit)
	}
	return listing[Commit](ctx, d.http, d.path()+"/commits", query)
}

func (d *Disk) Diff(ctx context.Context, against string) ([]Change, error) {
	return Collect(listing[Change](ctx, d.http, d.path()+"/diff", d.on().with("against", against)))
}

func (d *Disk) Revert(ctx context.Context, commit string, options ...CommitOptions) (Committed, error) {
	body := compact(map[string]any{"commit": commit, "message": first(options).Message, "branch": d.Branch})
	var committed Committed
	err := d.http.post(ctx, d.path()+"/revert", body, nil, &committed)
	return committed, err
}

func (d *Disk) Restore(ctx context.Context, commit string) (Committed, error) {
	var committed Committed
	body := map[string]any{"to": commit, "branch": d.Branch}
	err := d.http.post(ctx, d.path()+"/restore", body, nil, &committed)
	return committed, err
}

func (d *Disk) RestoreTo(ctx context.Context, at time.Time) (Committed, error) {
	commit, err := d.commitAt(ctx, at)
	if err != nil {
		return Committed{}, err
	}
	return d.Restore(ctx, commit)
}

func (d *Disk) commitAt(ctx context.Context, at time.Time) (string, error) {
	for commit, err := range d.Log(ctx, LogOptions{Limit: 1000}) {
		if err != nil {
			return "", err
		}
		if !commit.Created.After(at) {
			return commit.ID, nil
		}
	}
	return "", fmt.Errorf("disk `%s` has no commit from %s or before", d.Name, at.UTC().Format(time.RFC3339))
}
