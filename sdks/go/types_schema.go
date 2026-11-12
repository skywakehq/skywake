package skywake

import "encoding/json"

type VectorColumn struct {
	Name    string `json:"name"`
	Dims    int    `json:"dims"`
	Metric  string `json:"metric,omitempty"`
	Element string `json:"element,omitempty"`
	// Embed, such as {"model": "..."}, lets the vector be given as text.
	Embed map[string]string `json:"embed,omitempty"`
}

// Attribute is a typed attribute. A "text" one is searched by BM25 and may
// set K1 and B, the Language it is stemmed in ("english" when empty, or
// "none") and whether it drops that language's Stopwords. FilterIndex keeps
// the attribute's rows sorted by value, so a filter on it that passes few
// rows reads only those.
type Attribute struct {
	Name        string   `json:"name"`
	Type        string   `json:"type"`
	K1          *float64 `json:"k1,omitempty"`
	B           *float64 `json:"b,omitempty"`
	Language    string   `json:"language,omitempty"`
	Stopwords   bool     `json:"stopwords,omitempty"`
	FilterIndex bool     `json:"filter_index,omitempty"`
}

// Schema is the columns of an index. ID "uuid" makes every id a UUID,
// returned lowercase with dashes; by default an id is a string or a whole
// number.
type Schema struct {
	Vectors    []VectorColumn `json:"vectors"`
	Attributes []Attribute    `json:"attributes"`
	ID         string         `json:"id,omitempty"`
}

// Encryption names a key in your cloud's key service that encrypts the index.
type Encryption struct {
	KMSKeyID string `json:"kms_key_id"`
}

// Pinned reserves Replicas servers (1 to 8) that keep the index open and on
// their disks, billed per GB-hour for each replica instead of per query.
type Pinned struct {
	Replicas int `json:"replicas"`
}

// Pinning is where an index is pinned: fewer replicas than asked while fewer
// servers run.
type Pinning struct {
	Replicas []PinnedReplica `json:"replicas"`
}

// PinnedReplica is one server holding a pinned index. Warm is true once every
// object of the current version is on its disk.
type PinnedReplica struct {
	Server   string `json:"server"`
	Warm     bool   `json:"warm"`
	InFlight int    `json:"in_flight"`
}

// NewIndex makes an index. Shards splits the documents (1 by default).
type NewIndex struct {
	Name       string      `json:"name"`
	Schema     Schema      `json:"schema"`
	Region     string      `json:"region,omitempty"`
	Shards     int         `json:"shards,omitempty"`
	Encryption *Encryption `json:"encryption,omitempty"`
	Pinned     *Pinned     `json:"pinned,omitempty"`
}

// UpdateIndex adds attributes, makes the index read-only or writable again,
// or pins it, on every branch.
type UpdateIndex struct {
	Attributes []Attribute `json:"attributes,omitempty"`
	ReadOnly   *bool       `json:"read_only,omitempty"`
	// RetentionDays is how long older versions stay after they were
	// replaced. Set KeepAllVersions instead to keep every one.
	RetentionDays   *int `json:"retention_days,omitempty"`
	KeepAllVersions bool `json:"-"`
	// Pinned pins the index to its replicas. Set Unpin instead to unpin it.
	Pinned *Pinned `json:"pinned,omitempty"`
	Unpin  bool    `json:"-"`
}

// MarshalJSON sends a null retention for KeepAllVersions and a null pinned
// for Unpin.
func (u UpdateIndex) MarshalJSON() ([]byte, error) {
	type plain UpdateIndex
	body, err := json.Marshal(plain(u))
	if err != nil || !u.KeepAllVersions && !u.Unpin {
		return body, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		return nil, err
	}
	if u.KeepAllVersions {
		fields["retention_days"] = json.RawMessage("null")
	}
	if u.Unpin {
		fields["pinned"] = json.RawMessage("null")
	}
	return json.Marshal(fields)
}

// CopyIndex copies a branch to a new index, as its main.
type CopyIndex struct {
	Name       string      `json:"name"`
	Region     string      `json:"region,omitempty"`
	Encryption *Encryption `json:"encryption,omitempty"`
}

// Index is an index's settings. Pinned is nil when it is not pinned. Stats,
// of main, and Pinning are only read by Get; Stats is nil while the server
// cannot count them.
type Index struct {
	Name       string      `json:"name"`
	Region     string      `json:"region"`
	Schema     Schema      `json:"schema"`
	Shards     int         `json:"shards"`
	Encryption *Encryption `json:"encryption"`
	ReadOnly   bool        `json:"read_only"`
	// RetentionDays is nil when every version is kept.
	RetentionDays *int     `json:"retention_days"`
	Pinned        *Pinned  `json:"pinned"`
	Created       string   `json:"created"`
	Stats         *Stats   `json:"stats,omitempty"`
	Pinning       *Pinning `json:"pinning,omitempty"`
}

// Stats are a branch's counts.
type Stats struct {
	Rows          int `json:"rows"`
	DeletedRows   int `json:"deleted_rows"`
	Segments      int `json:"segments"`
	IndexedRows   int `json:"indexed_rows"`
	UnindexedRows int `json:"unindexed_rows"`
	Clusters      int `json:"clusters"`
	Bytes         int `json:"bytes"`
}

type Branch struct {
	Name       string  `json:"name"`
	ForkedFrom *string `json:"forked_from"`
	Created    string  `json:"created"`
}

// Version is a branch at one moment of its history.
type Version struct {
	Version string `json:"version"`
	Time    string `json:"time"`
	Rows    int    `json:"rows"`
}

// Operation is a build or warming, and how it went: Status is "running",
// "succeeded" or "failed".
type Operation struct {
	ID       string  `json:"id"`
	Index    string  `json:"index"`
	Branch   string  `json:"branch"`
	Kind     string  `json:"kind"`
	Status   string  `json:"status"`
	Error    *string `json:"error"`
	Started  string  `json:"started"`
	Finished *string `json:"finished"`
}

type UsageDay struct {
	Day        string `json:"day"`
	Queries    int    `json:"queries"`
	Writes     int    `json:"writes"`
	Deletes    int    `json:"deletes"`
	Embeddings int    `json:"embeddings"`
	Reranks    int    `json:"reranks"`
	// Nil on a day with no snapshot of the index's size.
	Rows  *int `json:"rows"`
	Bytes *int `json:"bytes"`
}
