package skywake

import "time"

type DiskSummary struct {
	Name       string    `json:"name"`
	Region     string    `json:"region"`
	Visibility string    `json:"visibility"`
	Created    time.Time `json:"created"`
}

type DiskInfo struct {
	DiskSummary
	Search   bool     `json:"search"`
	Branches []string `json:"branches"`
}

type DiskOptions struct {
	Region     string
	Search     *bool
	Visibility string
}

type DiskSettings struct {
	Search     *bool  `json:"search,omitempty"`
	Visibility string `json:"visibility,omitempty"`
}

type Entry struct {
	Path       string     `json:"path"`
	Kind       string     `json:"kind"`
	Size       int64      `json:"size"`
	Modified   *time.Time `json:"modified"`
	Executable bool       `json:"executable"`
	Target     string     `json:"target,omitempty"`
}

type Commit struct {
	ID      string    `json:"id"`
	Message string    `json:"message"`
	Created time.Time `json:"created"`
	Merged  string    `json:"merged"`
}

type Committed struct {
	Commit  string `json:"commit"`
	Changed bool   `json:"changed"`
}

type Change struct {
	Path   string `json:"path"`
	Change string `json:"change"`
}

type Match struct {
	Path string `json:"path"`
	Line int    `json:"line"`
	Text string `json:"text"`
}

type Found struct {
	Path string `json:"path"`
	Kind string `json:"kind"`
	Size int64  `json:"size"`
}

type FileHit struct {
	Path    string  `json:"path"`
	Score   float64 `json:"score"`
	Snippet string  `json:"snippet"`
}

type Merged struct {
	Commit    string   `json:"commit"`
	Conflicts []string `json:"conflicts"`
}

type ReadOptions struct {
	At     string
	Offset int64
	Length int64
}

type WriteOptions struct {
	Message    string
	Executable *bool
}

type CommitOptions struct {
	Message string
}

type ListOptions struct {
	Recursive bool
	At        string
}

type AtOptions struct {
	At string
}

type GrepOptions struct {
	Path       string `json:"path,omitempty"`
	Glob       string `json:"glob,omitempty"`
	IgnoreCase bool   `json:"ignore_case,omitempty"`
	Limit      int    `json:"limit,omitempty"`
	At         string `json:"at,omitempty"`
}

type FindOptions struct {
	Path  string `json:"path,omitempty"`
	Kind  string `json:"kind,omitempty"`
	Limit int    `json:"limit,omitempty"`
	At    string `json:"at,omitempty"`
}

type SearchOptions struct {
	Limit int    `json:"limit,omitempty"`
	Path  string `json:"path,omitempty"`
}

type MergeOptions struct {
	Message string `json:"message,omitempty"`
	DryRun  bool   `json:"dry_run,omitempty"`
	Prefer  string `json:"prefer,omitempty"`
}

type LogOptions struct {
	Path  string
	Limit int
}

type DownloadOptions struct {
	At          string
	Concurrency int
}

type UploadOptions struct {
	Message     string
	Concurrency int
}
