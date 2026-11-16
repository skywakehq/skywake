package skywake

import "time"

type Row = map[string]any

type Hit = map[string]any

type Filter = map[string]any

type Group = map[string]any

type Schema struct {
	Vectors    []VectorColumn    `json:"vectors,omitempty"`
	Attributes []AttributeColumn `json:"attributes,omitempty"`
	ID         string            `json:"id,omitempty"`
}

type VectorColumn struct {
	Name    string `json:"name"`
	Dims    int    `json:"dims"`
	Metric  string `json:"metric,omitempty"`
	Element string `json:"element,omitempty"`
	Embed   *Embed `json:"embed,omitempty"`
}

type AttributeColumn struct {
	Name           string   `json:"name"`
	Type           string   `json:"type"`
	K1             *float64 `json:"k1,omitempty"`
	B              *float64 `json:"b,omitempty"`
	Language       string   `json:"language,omitempty"`
	Stopwords      *bool    `json:"stopwords,omitempty"`
	Stemming       *bool    `json:"stemming,omitempty"`
	Filterable     *bool    `json:"filterable,omitempty"`
	CaseSensitive  *bool    `json:"case_sensitive,omitempty"`
	ASCIIFolding   *bool    `json:"ascii_folding,omitempty"`
	MaxTokenLength int      `json:"max_token_length,omitempty"`
	PreTokenized   *bool    `json:"pre_tokenized,omitempty"`
	FilterIndex    *bool    `json:"filter_index,omitempty"`
}

type Embed struct {
	Model string `json:"model"`
	From  string `json:"from,omitempty"`
}

type IndexOptions struct {
	Schema  *Schema
	Region  string
	Embed   *Embed
	NoEmbed bool
}

type IndexSummary struct {
	Name    string    `json:"name"`
	Region  string    `json:"region"`
	Created time.Time `json:"created"`
}

type IndexInfo struct {
	IndexSummary
	Schema        Schema   `json:"schema"`
	Rows          *int64   `json:"rows"`
	Bytes         *int64   `json:"bytes"`
	ReadOnly      bool     `json:"read_only"`
	RetentionDays *int     `json:"retention_days"`
	Branches      []string `json:"branches"`
}

type Version struct {
	ID      string    `json:"id"`
	Created time.Time `json:"created"`
	Rows    *int64    `json:"rows"`
}

type Upserted struct {
	IDs   []any `json:"ids"`
	Count int   `json:"count"`
}

type IndexMerged struct {
	Rows int `json:"rows"`
}

type QueryOptions struct {
	Vector []float64         `json:"vector,omitempty"`
	Filter Filter            `json:"filter,omitempty"`
	Limit  int               `json:"limit,omitempty"`
	Mode   string            `json:"mode,omitempty"`
	Sort   map[string]string `json:"sort,omitempty"`
	Fields []string          `json:"fields,omitempty"`
}

type AggregateOptions struct {
	GroupBy []string `json:"group_by,omitempty"`
	Count   bool     `json:"count,omitempty"`
	Sum     []string `json:"sum,omitempty"`
	Avg     []string `json:"avg,omitempty"`
	Min     []string `json:"min,omitempty"`
	Max     []string `json:"max,omitempty"`
	Filter  Filter   `json:"filter,omitempty"`
}

type Pinned struct {
	Replicas int `json:"replicas"`
}

type IndexSettings struct {
	ReadOnly       *bool             `json:"read_only,omitempty"`
	RetentionDays  *int              `json:"retention_days,omitempty"`
	Pinned         *Pinned           `json:"pinned,omitempty"`
	Attributes     []AttributeColumn `json:"attributes,omitempty"`
	DropAttributes []string          `json:"drop_attributes,omitempty"`
}

type CopyOptions struct {
	Environment string
}
