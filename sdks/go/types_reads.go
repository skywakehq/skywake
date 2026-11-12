package skywake

// Per keeps at most Limit hits for each set of values of Attributes.
type Per struct {
	Attributes []string `json:"attributes"`
	Limit      int      `json:"limit"`
}

// Rerank orders hits again with a rerank model, by Query or by the
// request's own text.
type Rerank struct {
	Model string `json:"model"`
	Field string `json:"field"`
	Query string `json:"query,omitempty"`
	TopN  int    `json:"topN,omitempty"`
}

// Vector is what a query searches near: numbers, or text or {"image": url}
// when the column embeds.
type Vector struct {
	Column string `json:"column"`
	Value  any    `json:"value"`
}

// Query finds the TopK nearest documents that pass Filter. Recall is the
// share of the true nearest to find (0.95 by default; 1 reads every cluster
// and returns exactly the true nearest by the column's metric); Probe
// overrides it with a number of clusters. Consistency "eventual" may read
// what the server saw up to a minute ago, which is faster.
type Query struct {
	Vector      Vector   `json:"vector"`
	TopK        int      `json:"topK,omitempty"`
	Recall      float64  `json:"recall,omitempty"`
	Probe       int      `json:"probe,omitempty"`
	Filter      any      `json:"filter,omitempty"`
	Include     []string `json:"include,omitempty"`
	Exclude     []string `json:"exclude,omitempty"`
	Offset      int      `json:"offset,omitempty"`
	Per         *Per     `json:"per,omitempty"`
	Consistency string   `json:"consistency,omitempty"`
	Rerank      *Rerank  `json:"rerank,omitempty"`
}

// Search finds the documents that best match Query by BM25. K1 and B are
// pointers because 0 is a value of theirs.
type Search struct {
	Query       string             `json:"query"`
	Fields      []string           `json:"fields,omitempty"`
	Boosts      map[string]float64 `json:"boosts,omitempty"`
	TopK        int                `json:"topK,omitempty"`
	K1          *float64           `json:"k1,omitempty"`
	B           *float64           `json:"b,omitempty"`
	Filter      any                `json:"filter,omitempty"`
	Include     []string           `json:"include,omitempty"`
	Exclude     []string           `json:"exclude,omitempty"`
	Highlight   []string           `json:"highlight,omitempty"`
	Fuzzy       int                `json:"fuzzy,omitempty"`
	Offset      int                `json:"offset,omitempty"`
	Per         *Per               `json:"per,omitempty"`
	Consistency string             `json:"consistency,omitempty"`
	Rerank      *Rerank            `json:"rerank,omitempty"`
}

// Fuse sets reciprocal rank fusion: a hit scores the sum of
// weight / (K + rank); K is 60 and weights 1 by default.
type Fuse struct {
	K       int                `json:"k,omitempty"`
	Weights map[string]float64 `json:"weights,omitempty"`
}

// Hybrid runs named searches, each a Query or a Search, on one snapshot
// and fuses them. Rank scores the hits by an expression instead.
type Hybrid struct {
	Searches    map[string]any `json:"searches"`
	TopK        int            `json:"topK,omitempty"`
	Fuse        Fuse           `json:"fuse"`
	Offset      int            `json:"offset,omitempty"`
	Per         *Per           `json:"per,omitempty"`
	Consistency string         `json:"consistency,omitempty"`
	Rank        any            `json:"rank,omitempty"`
	Rerank      *Rerank        `json:"rerank,omitempty"`
}

// Order lists documents in the order of an attribute, or of "id"; those
// without it come last.
type Order struct {
	By          string   `json:"by"`
	Descending  bool     `json:"descending,omitempty"`
	TopK        int      `json:"topK,omitempty"`
	Offset      int      `json:"offset,omitempty"`
	Filter      any      `json:"filter,omitempty"`
	Include     []string `json:"include,omitempty"`
	Exclude     []string `json:"exclude,omitempty"`
	Consistency string   `json:"consistency,omitempty"`
}

// Rank scores every document that passes Filter exactly, such as by
// {"dot": {"attribute", "indices", "values"}} for sparse vectors or
// {"max_sim": {"attribute", "vectors"}} for late interaction.
type Rank struct {
	Score       any      `json:"score"`
	TopK        int      `json:"topK,omitempty"`
	Offset      int      `json:"offset,omitempty"`
	Filter      any      `json:"filter,omitempty"`
	Include     []string `json:"include,omitempty"`
	Exclude     []string `json:"exclude,omitempty"`
	Consistency string   `json:"consistency,omitempty"`
}

// Aggregate measures the documents that pass Filter, in one group or one
// per set of GroupBy values. Each measure is named, such as
// {"total": {"count"}, "revenue": {"sum", "price"}}.
type Aggregate struct {
	Filter      any                 `json:"filter,omitempty"`
	GroupBy     []string            `json:"groupBy,omitempty"`
	Measures    map[string][]string `json:"measures"`
	Consistency string              `json:"consistency,omitempty"`
}

// MultiRequest is one request of a Multi: set one field.
type MultiRequest struct {
	Query     *Query     `json:"query,omitempty"`
	Search    *Search    `json:"search,omitempty"`
	Hybrid    *Hybrid    `json:"hybrid,omitempty"`
	Order     *Order     `json:"order,omitempty"`
	Rank      *Rank      `json:"rank,omitempty"`
	Aggregate *Aggregate `json:"aggregate,omitempty"`
}

// RecallCheck asks how many of the true nearest documents queries find.
type RecallCheck struct {
	Column  string  `json:"column,omitempty"`
	Queries int     `json:"queries,omitempty"`
	TopK    int     `json:"topK,omitempty"`
	Recall  float64 `json:"recall,omitempty"`
	Filter  any     `json:"filter,omitempty"`
}
