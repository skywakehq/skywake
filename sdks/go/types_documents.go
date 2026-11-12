package skywake

// DocID is a string, or a whole number from 0. Numbers come back as float64.
type DocID = any

// Document is a document as written and read. A vector may be text, or
// {"image": url}, when its column embeds.
type Document struct {
	ID         DocID          `json:"id"`
	Vectors    map[string]any `json:"vectors,omitempty"`
	Attributes map[string]any `json:"attributes,omitempty"`
}

// Patch sets attributes of a document; a nil value removes one.
type Patch struct {
	ID         DocID          `json:"id"`
	Attributes map[string]any `json:"attributes"`
}

// PatchBy sets attributes of every document that passes Filter.
type PatchBy struct {
	Filter     any            `json:"filter"`
	Attributes map[string]any `json:"attributes"`
}

// Write is upserts, patches and deletes as one change, in this order:
// DeleteBy, PatchBy, Upserts, Patches, Deletes. A condition is a filter
// checked against each document as it was, whose values may be
// {"$ref_new": attribute}.
type Write struct {
	Upserts  []Document `json:"upserts,omitempty"`
	Patches  []Patch    `json:"patches,omitempty"`
	Deletes  []DocID    `json:"deletes,omitempty"`
	UpsertIf any        `json:"upsertIf,omitempty"`
	PatchIf  any        `json:"patchIf,omitempty"`
	DeleteIf any        `json:"deleteIf,omitempty"`
	DeleteBy any        `json:"deleteBy,omitempty"`
	PatchBy  *PatchBy   `json:"patchBy,omitempty"`
	// ReturnAffectedIDs also returns the ids behind the counts.
	ReturnAffectedIDs bool `json:"returnAffectedIds,omitempty"`
}

// WriteCounts is what a write did. The ids are there when the write set
// ReturnAffectedIDs.
type WriteCounts struct {
	Upserted    int     `json:"upserted"`
	Patched     int     `json:"patched"`
	Deleted     int     `json:"deleted"`
	UpsertedIDs []DocID `json:"upserted_ids,omitempty"`
	PatchedIDs  []DocID `json:"patched_ids,omitempty"`
	DeletedIDs  []DocID `json:"deleted_ids,omitempty"`
	Billing     Billing `json:"billing"`
}

// DocumentPage is one page of documents. Pass Next as the cursor of the
// next page; it is nil on the last.
type DocumentPage struct {
	Documents []Document `json:"documents"`
	Next      *string    `json:"next"`
}
