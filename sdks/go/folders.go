package skywake

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type localFile struct {
	path       string
	file       string
	size       int64
	executable bool
}

func (d *Disk) Download(ctx context.Context, dir string, options ...DownloadOptions) (string, error) {
	o := first(options)
	at := o.At
	if at == "" {
		head, err := d.Head(ctx)
		if err != nil {
			return "", err
		}
		at = head
	}
	root, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(root, 0o755); err != nil || at == "" {
		return "", err
	}
	entries, err := Collect(d.Walk(ctx, "", AtOptions{At: at}))
	if err != nil {
		return "", err
	}
	var files []Entry
	for _, entry := range entries {
		if entry.Kind != "folder" {
			files = append(files, entry)
			continue
		}
		folder, err := inside(root, entry.Path)
		if err == nil {
			err = os.MkdirAll(folder, 0o755)
		}
		if err != nil {
			return "", err
		}
	}
	_, err = concurrently(files, o.Concurrency, func(entry Entry) (struct{}, error) {
		return struct{}{}, d.save(ctx, root, entry, at)
	})
	return at, err
}

func inside(root, name string) (string, error) {
	file := filepath.Join(root, filepath.FromSlash(name))
	if !strings.HasPrefix(file, root+string(filepath.Separator)) {
		return "", fmt.Errorf("`%s` is outside %s", name, root)
	}
	return file, nil
}

func (d *Disk) save(ctx context.Context, root string, entry Entry, at string) error {
	file, err := inside(root, entry.Path)
	if err != nil {
		return err
	}
	if entry.Kind == "symlink" {
		os.Remove(file)
		return os.Symlink(entry.Target, file)
	}
	body, err := d.open(ctx, entry.Path, ReadOptions{At: at})
	if err != nil {
		return err
	}
	defer body.Close()
	out, err := os.Create(file)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, body); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil || !entry.Executable {
		return err
	}
	return os.Chmod(file, 0o755)
}

func (d *Disk) Upload(ctx context.Context, dir string, options ...UploadOptions) (string, error) {
	o := first(options)
	root, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	files, err := localFiles(root)
	if err != nil {
		return "", err
	}
	head := ""
	weigh := func(file localFile) int { return weight(file.path, file.size) }
	for _, batch := range batches(files, commitCount, commitBytes, weigh) {
		changes, err := concurrently(batch, o.Concurrency, func(file localFile) (FileChange, error) {
			return d.changeFrom(ctx, file)
		})
		if err != nil {
			return "", err
		}
		committed, err := d.Commit(ctx, changes, o.Message)
		if err != nil {
			return "", err
		}
		head = committed.Commit
	}
	if head != "" {
		return head, nil
	}
	return d.Head(ctx)
}

func localFiles(root string) ([]localFile, error) {
	var found []localFile
	err := filepath.WalkDir(root, func(file string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Name() == ".git" {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		name, err := filepath.Rel(root, file)
		found = append(found, localFile{
			path:       filepath.ToSlash(name),
			file:       file,
			size:       info.Size(),
			executable: info.Mode()&0o111 != 0,
		})
		return err
	})
	sort.Slice(found, func(i, j int) bool { return found[i].path < found[j].path })
	return found, err
}

func (d *Disk) changeFrom(ctx context.Context, file localFile) (FileChange, error) {
	executable := file.executable
	if file.size <= inlineMax {
		content, err := os.ReadFile(file.file)
		if err != nil {
			return FileChange{}, err
		}
		return changeOf(ctx, file.path, content, d.Part, &executable)
	}
	handle, err := os.Open(file.file)
	if err != nil {
		return FileChange{}, err
	}
	defer handle.Close()
	change := FileChange{Path: file.path, Executable: &executable, Parts: []string{}}
	for offset := int64(0); offset < file.size; offset += partMax {
		part := make([]byte, min(partMax, file.size-offset))
		if _, err := handle.ReadAt(part, offset); err != nil {
			return FileChange{}, err
		}
		uploaded, err := d.Part(ctx, part)
		if err != nil {
			return FileChange{}, err
		}
		change.Parts = append(change.Parts, uploaded)
	}
	return change, nil
}
