package skywake

import (
	"context"
	"errors"
	"io"
	"iter"
	"net/http"
	"sort"
	"strconv"
	"strings"
)

type Disk struct {
	Name   string
	Branch string
	http   *transport
}

func (d *Disk) path() string { return "/disks/" + segment(d.Name) }

func (d *Disk) on() params { return params{"branch": d.Branch} }

func (d *Disk) On(branch string) *Disk {
	return &Disk{Name: d.Name, Branch: branch, http: d.http}
}

func clean(path string) string { return strings.Trim(path, "/") }

func parentOf(path string) string {
	if i := strings.LastIndex(path, "/"); i >= 0 {
		return path[:i]
	}
	return ""
}

func number(n int64) string {
	if n == 0 {
		return ""
	}
	return strconv.FormatInt(n, 10)
}

func (d *Disk) open(ctx context.Context, path string, options ReadOptions) (io.ReadCloser, error) {
	query := d.on()
	query["at"], query["offset"], query["length"] = options.At, number(options.Offset), number(options.Length)
	response, err := d.http.open(ctx, call{method: http.MethodGet, path: d.path() + "/files/" + filePath(path), query: query})
	if err != nil {
		return nil, err
	}
	return response.Body, nil
}

func (d *Disk) ReadBytes(ctx context.Context, path string, options ...ReadOptions) ([]byte, error) {
	body, err := d.open(ctx, path, first(options))
	if err != nil {
		return nil, err
	}
	defer body.Close()
	return io.ReadAll(body)
}

func (d *Disk) Read(ctx context.Context, path string, options ...ReadOptions) (string, error) {
	content, err := d.ReadBytes(ctx, path, options...)
	return string(content), err
}

func (d *Disk) Write(ctx context.Context, path string, content []byte, options ...WriteOptions) (Committed, error) {
	return d.WriteFiles(ctx, map[string][]byte{path: content}, options...)
}

func (d *Disk) WriteFiles(ctx context.Context, files map[string][]byte, options ...WriteOptions) (Committed, error) {
	asked := first(options)
	paths := make([]string, 0, len(files))
	for path := range files {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	changes := make([]FileChange, len(paths))
	for i, path := range paths {
		change, err := changeOf(ctx, clean(path), files[path], d.Part, asked.Executable)
		if err != nil {
			return Committed{}, err
		}
		changes[i] = change
	}
	return d.Commit(ctx, changes, asked.Message)
}

func (d *Disk) Delete(ctx context.Context, path string, options ...CommitOptions) (Committed, error) {
	return d.DeleteFiles(ctx, []string{path}, options...)
}

func (d *Disk) DeleteFiles(ctx context.Context, paths []string, options ...CommitOptions) (Committed, error) {
	changes := make([]FileChange, len(paths))
	for i, path := range paths {
		changes[i] = FileChange{Path: clean(path), Delete: true}
	}
	return d.Commit(ctx, changes, first(options).Message)
}

func (d *Disk) Move(ctx context.Context, from, to string, options ...CommitOptions) (Committed, error) {
	from, to = clean(from), clean(to)
	changes := []FileChange{{Path: to, From: &FileFrom{Path: from}}, {Path: from, Delete: true}}
	return d.Commit(ctx, changes, firstSet(first(options).Message, "Move "+from+" to "+to))
}

func (d *Disk) Commit(ctx context.Context, changes []FileChange, message string) (Committed, error) {
	var committed Committed
	body := map[string]any{"changes": changes, "branch": d.Branch}
	if message != "" {
		body["message"] = message
	}
	err := d.http.post(ctx, d.path()+"/commits", body, nil, &committed)
	return committed, err
}

func (d *Disk) Part(ctx context.Context, content []byte) (string, error) {
	var uploaded struct{ Part string }
	err := d.http.do(ctx, call{method: http.MethodPost, path: d.path() + "/uploads", bytes: content}, &uploaded)
	return uploaded.Part, err
}

func (d *Disk) Entries(ctx context.Context, path string, options ...ListOptions) iter.Seq2[Entry, error] {
	o := first(options)
	query := d.on()
	query["path"], query["at"], query["limit"] = clean(path), o.At, "1000"
	if o.Recursive {
		query["recursive"] = "true"
	}
	return listing[Entry](ctx, d.http, d.path()+"/files", query)
}

func (d *Disk) List(ctx context.Context, path string, options ...ListOptions) ([]Entry, error) {
	return Collect(d.Entries(ctx, path, options...))
}

func (d *Disk) Walk(ctx context.Context, path string, options ...AtOptions) iter.Seq2[Entry, error] {
	at := first(options).At
	return func(yield func(Entry, error) bool) {
		d.walk(ctx, path, at, yield)
	}
}

func (d *Disk) walk(ctx context.Context, path, at string, yield func(Entry, error) bool) bool {
	for entry, err := range d.Entries(ctx, path, ListOptions{At: at}) {
		if !yield(entry, err) || err != nil {
			return false
		}
		if entry.Kind == "folder" && !d.walk(ctx, entry.Path, at, yield) {
			return false
		}
	}
	return true
}

func (d *Disk) Stat(ctx context.Context, path string, options ...AtOptions) (*Entry, error) {
	target := clean(path)
	if target == "" {
		return &Entry{Kind: "folder"}, nil
	}
	for entry, err := range d.Entries(ctx, parentOf(target), ListOptions{At: first(options).At}) {
		var missing *NotFound
		if errors.As(err, &missing) {
			_, err = d.Info(ctx)
			return nil, err
		}
		if err != nil {
			return nil, err
		}
		if entry.Path == target {
			return &entry, nil
		}
		if entry.Path > target {
			return nil, nil
		}
	}
	return nil, nil
}

func (d *Disk) Exists(ctx context.Context, path string, options ...AtOptions) (bool, error) {
	entry, err := d.Stat(ctx, path, options...)
	return entry != nil, err
}

func (d *Disk) Grep(ctx context.Context, pattern string, options ...GrepOptions) ([]Match, error) {
	body := struct {
		Pattern string `json:"pattern"`
		GrepOptions
		Branch string `json:"branch"`
	}{pattern, first(options), d.Branch}
	return onePage[Match](ctx, d.http, d.path()+"/grep", body)
}

func (d *Disk) Find(ctx context.Context, glob string, options ...FindOptions) ([]Found, error) {
	body := struct {
		Glob string `json:"glob"`
		FindOptions
		Branch string `json:"branch"`
	}{glob, first(options), d.Branch}
	return onePage[Found](ctx, d.http, d.path()+"/find", body)
}

func (d *Disk) Query(ctx context.Context, text string, options ...SearchOptions) ([]FileHit, error) {
	body := struct {
		Text string `json:"text"`
		SearchOptions
		Branch string `json:"branch"`
	}{text, first(options), d.Branch}
	return onePage[FileHit](ctx, d.http, d.path()+"/query", body)
}

func (d *Disk) Info(ctx context.Context) (DiskInfo, error) {
	var info DiskInfo
	err := d.http.get(ctx, d.path(), nil, &info)
	return info, err
}

func (d *Disk) Configure(ctx context.Context, settings DiskSettings) (DiskInfo, error) {
	var info DiskInfo
	err := d.http.patch(ctx, d.path(), settings, nil, &info)
	return info, err
}
