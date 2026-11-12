package skywake

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// Error is an error answer from the API.
type Error struct {
	Status  int
	Message string
	// Code says what kind of error it is, such as "not_found" or "rate_limited".
	Code string
	// RequestID is worth quoting when you report a bug.
	RequestID string
	// Path is the JSON path of the field that is wrong, for an invalid request.
	Path string
}

func (e *Error) Error() string {
	return fmt.Sprintf("%d: %s", e.Status, e.Message)
}

// check returns the answer's error, if it is one.
func check(resp *http.Response) error {
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	text, _ := io.ReadAll(resp.Body)
	var body struct {
		Error     *string `json:"error"`
		Code      string  `json:"code"`
		RequestID string  `json:"request_id"`
		Path      string  `json:"path"`
	}
	e := &Error{Status: resp.StatusCode, Message: string(text)}
	if json.Unmarshal(text, &body) == nil && body.Error != nil {
		e.Message, e.Code, e.RequestID, e.Path = *body.Error, body.Code, body.RequestID, body.Path
	}
	if e.RequestID == "" {
		e.RequestID = resp.Header.Get("X-Request-Id")
	}
	return e
}
