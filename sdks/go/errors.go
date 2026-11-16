package skywake

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

type APIError struct {
	Status    int
	Code      string
	Message   string
	Hint      string
	RequestID string
	Path      string
}

func (e *APIError) Error() string {
	if e.Hint != "" {
		return e.Message + "; " + e.Hint
	}
	return e.Message
}

type AuthError struct{ APIError }

type PermissionError struct{ APIError }

type NotFound struct{ APIError }

type Conflict struct{ APIError }

type InvalidRequest struct{ APIError }

type ServerError struct{ APIError }

type MergeConflict struct {
	APIError
	Conflicts []string
}

func (e *MergeConflict) As(target any) bool {
	conflict, ok := target.(**Conflict)
	if ok {
		*conflict = &Conflict{e.APIError}
	}
	return ok
}

type RateLimited struct {
	APIError
	RetryAfter time.Duration
}

type errorBody struct {
	Code      string   `json:"code"`
	Message   string   `json:"message"`
	Hint      string   `json:"hint"`
	RequestID string   `json:"request_id"`
	Path      string   `json:"path"`
	Conflicts []string `json:"conflicts"`
}

func parseError(raw []byte) errorBody {
	var envelope struct {
		Error json.RawMessage `json:"error"`
		Code  string          `json:"code"`
	}
	var body errorBody
	if json.Unmarshal(raw, &envelope) != nil {
		return body
	}
	if json.Unmarshal(envelope.Error, &body) == nil {
		return body
	}
	json.Unmarshal(envelope.Error, &body.Message)
	body.Code = envelope.Code
	return body
}

func errorOf(response *http.Response, raw []byte) error {
	body := parseError(raw)
	status := response.StatusCode
	fields := APIError{
		Status:    status,
		Code:      body.Code,
		Message:   firstSet(body.Message, http.StatusText(status), fmt.Sprintf("HTTP %d", status)),
		Hint:      body.Hint,
		RequestID: firstSet(body.RequestID, response.Header.Get("x-request-id")),
		Path:      body.Path,
	}
	switch {
	case status == 401:
		return &AuthError{fields}
	case status == 403:
		return &PermissionError{fields}
	case status == 404:
		return &NotFound{fields}
	case status == 409 && len(body.Conflicts) > 0:
		return &MergeConflict{fields, body.Conflicts}
	case status == 409:
		return &Conflict{fields}
	case status == 429:
		return &RateLimited{fields, retryAfter(response.Header)}
	case status >= 500:
		return &ServerError{fields}
	}
	return &InvalidRequest{fields}
}

func retryAfter(header http.Header) time.Duration {
	seconds, err := strconv.ParseFloat(header.Get("retry-after"), 64)
	if err != nil || seconds <= 0 {
		return 0
	}
	return time.Duration(seconds * float64(time.Second))
}
