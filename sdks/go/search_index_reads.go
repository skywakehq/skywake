package skywake

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"iter"
	"net/url"
)

// read posts a read and returns the list in its answer's field.
func read[T any](ctx context.Context, s *SearchIndex, route, field string, body any) (*Results[T], error) {
	answer, err := post[map[string]json.RawMessage](ctx, s, route, body)
	if err != nil {
		return nil, err
	}
	results := &Results[T]{}
	for name, out := range map[string]any{field: &results.Items, "performance": &results.Performance, "billing": &results.Billing} {
		if raw, ok := answer[name]; ok {
			if err := json.Unmarshal(raw, out); err != nil {
				return nil, err
			}
		}
	}
	return results, nil
}

// Query returns the nearest documents to a vector, nearest first.
func (s *SearchIndex) Query(ctx context.Context, q Query) (*Results[Hit], error) {
	return read[Hit](ctx, s, "query", "hits", q)
}

// Search returns the documents that best match words by BM25, best first.
func (s *SearchIndex) Search(ctx context.Context, q Search) (*Results[SearchHit], error) {
	return read[SearchHit](ctx, s, "search", "hits", q)
}

// Hybrid fuses named searches on one snapshot.
func (s *SearchIndex) Hybrid(ctx context.Context, q Hybrid) (*Results[FusedHit], error) {
	return read[FusedHit](ctx, s, "hybrid", "hits", q)
}

// Order returns documents in the order of an attribute, or of "id".
func (s *SearchIndex) Order(ctx context.Context, q Order) (*Results[Row], error) {
	return read[Row](ctx, s, "order", "rows", q)
}

// Rank returns the documents that pass the filter, best first by an exact
// score. Those scoring 0 are left out.
func (s *SearchIndex) Rank(ctx context.Context, q Rank) (*Results[Ranked], error) {
	return read[Ranked](ctx, s, "rank", "hits", q)
}

// Aggregate counts, sums, averages and finds the least and most.
func (s *SearchIndex) Aggregate(ctx context.Context, q Aggregate) (*Results[Group], error) {
	return read[Group](ctx, s, "aggregate", "groups", q)
}

// Multi runs several requests on one snapshot. A request may not set its
// own consistency; set it here.
func (s *SearchIndex) Multi(ctx context.Context, requests []MultiRequest, consistency string) (*Results[MultiResult], error) {
	body := struct {
		Requests    []MultiRequest `json:"requests"`
		Consistency string         `json:"consistency,omitempty"`
	}{requests, consistency}
	return read[MultiResult](ctx, s, "multi", "results", body)
}

// Get returns the document with id. A missing one is an *Error with
// status 404, as a missing index or branch is.
func (s *SearchIndex) Get(ctx context.Context, id DocID) (*Document, error) {
	path := s.branchPath() + "/documents/" + escape(fmt.Sprint(id))
	doc, err := fetch[Document](ctx, s.c, "GET", path, nil, nil)
	return &doc, err
}

// Documents returns one page of documents by id, number ids first. It
// reads every segment, so it is for browsing. A limit of 0 is 100.
func (s *SearchIndex) Documents(ctx context.Context, limit int, cursor string) (*DocumentPage, error) {
	page, err := fetch[DocumentPage](ctx, s.c, "GET", s.branchPath()+"/documents", pageQuery(limit, "cursor", cursor), nil)
	return &page, err
}

// AllDocuments yields every document, a page at a time.
func (s *SearchIndex) AllDocuments(ctx context.Context) iter.Seq2[Document, error] {
	return func(yield func(Document, error) bool) {
		cursor := ""
		for {
			page, err := s.Documents(ctx, pageSize, cursor)
			if err != nil {
				yield(Document{}, err)
				return
			}
			for _, doc := range page.Documents {
				if !yield(doc, nil) {
					return
				}
			}
			if page.Next == nil || *page.Next == "" {
				return
			}
			cursor = *page.Next
		}
	}
}

// Export streams every document as it is now, in no set order.
func (s *SearchIndex) Export(ctx context.Context) iter.Seq2[Document, error] {
	return func(yield func(Document, error) bool) {
		resp, err := s.c.send(ctx, "GET", s.branchPath()+"/export", nil, nil)
		if err != nil {
			yield(Document{}, err)
			return
		}
		defer resp.Body.Close()
		if err := check(resp); err != nil {
			yield(Document{}, err)
			return
		}
		// The answer is one document per line, which a decoder reads in turn.
		decoder := json.NewDecoder(resp.Body)
		for decoder.More() {
			var doc Document
			if err := decoder.Decode(&doc); err != nil {
				yield(Document{}, err)
				return
			}
			if !yield(doc, nil) {
				return
			}
		}
	}
}

// ExportParquet returns every document as it is now, as a Parquet file
// read from the answer as it comes. Close it when done.
func (s *SearchIndex) ExportParquet(ctx context.Context) (io.ReadCloser, error) {
	query := url.Values{"format": {"parquet"}}
	resp, err := s.c.send(ctx, "GET", s.branchPath()+"/export", query, nil)
	if err != nil {
		return nil, err
	}
	if err := check(resp); err != nil {
		resp.Body.Close()
		return nil, err
	}
	return resp.Body, nil
}
