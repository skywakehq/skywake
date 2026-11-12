package skywake

// MultiResult holds the answer in the field its request was asked in.
type MultiResult struct {
	Query     []Hit       `json:"query,omitempty"`
	Search    []SearchHit `json:"search,omitempty"`
	Hybrid    []FusedHit  `json:"hybrid,omitempty"`
	Order     []Row       `json:"order,omitempty"`
	Rank      []Ranked    `json:"rank,omitempty"`
	Aggregate []Group     `json:"aggregate,omitempty"`
}

type Recall struct {
	Recall  float64 `json:"recall"`
	Queries int     `json:"queries"`
	Found   float64 `json:"found"`
	Exact   float64 `json:"exact"`
}

type Hit struct {
	ID          DocID          `json:"id"`
	Distance    float64        `json:"distance"`
	Attributes  map[string]any `json:"attributes"`
	RerankScore *float64       `json:"rerank_score,omitempty"`
}

// Highlight is the best fragment of a text attribute, with each matched
// word as [start, end) in UTF-16 code units.
type Highlight struct {
	Text  string   `json:"text"`
	Marks [][2]int `json:"marks"`
}

type SearchHit struct {
	ID          DocID                `json:"id"`
	Score       float64              `json:"score"`
	Attributes  map[string]any       `json:"attributes"`
	Highlights  map[string]Highlight `json:"highlights"`
	RerankScore *float64             `json:"rerank_score,omitempty"`
}

type FusedHit struct {
	ID          DocID                `json:"id"`
	Score       float64              `json:"score"`
	Ranks       map[string]int       `json:"ranks"`
	Scores      map[string]float64   `json:"scores"`
	Attributes  map[string]any       `json:"attributes"`
	Highlights  map[string]Highlight `json:"highlights"`
	RerankScore *float64             `json:"rerank_score,omitempty"`
}

type Row struct {
	ID         DocID          `json:"id"`
	Attributes map[string]any `json:"attributes"`
}

type Ranked struct {
	ID         DocID          `json:"id"`
	Score      float64        `json:"score"`
	Attributes map[string]any `json:"attributes"`
}

type Group struct {
	Key    map[string]any `json:"key"`
	Values map[string]any `json:"values"`
}

// Performance says how long a read took and where its reads came from.
type Performance struct {
	ServerMS         int     `json:"server_ms"`
	CacheTemperature string  `json:"cache_temperature"`
	CacheHitRatio    float64 `json:"cache_hit_ratio"`
}

// Billing is what a request counted toward the bill.
type Billing struct {
	Queries    int `json:"queries,omitempty"`
	Writes     int `json:"writes,omitempty"`
	Deletes    int `json:"deletes,omitempty"`
	Embeddings int `json:"embeddings,omitempty"`
	Reranks    int `json:"reranks,omitempty"`
}

// Results is what a read returns.
type Results[T any] struct {
	Items       []T
	Performance Performance
	Billing     Billing
}
