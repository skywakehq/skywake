package skywake

import "time"

type Whoami struct {
	Organization string     `json:"organization"`
	Environment  string     `json:"environment"`
	Role         string     `json:"role"`
	Only         []string   `json:"only"`
	Key          string     `json:"key"`
	User         string     `json:"user"`
	Email        string     `json:"email"`
	Expires      *time.Time `json:"expires"`
}

type NewKey struct {
	Name          string
	Role          string
	Environment   string
	Only          []string
	ExpiresInDays int
}

type Key struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	Role           string     `json:"role"`
	Environment    string     `json:"environment"`
	Only           []string   `json:"only"`
	Expires        *time.Time `json:"expires"`
	LastUsed       *time.Time `json:"last_used"`
	Created        time.Time  `json:"created"`
	CreatedBy      string     `json:"created_by"`
	CreatedByEmail string     `json:"created_by_email"`
}

type CreatedKey struct {
	ID  string `json:"id"`
	Key string `json:"key"`
}

type Environment struct {
	Name    string         `json:"name"`
	Created time.Time      `json:"created"`
	Store   map[string]any `json:"store"`
}

type Branch struct {
	Name    string    `json:"name"`
	From    string    `json:"from"`
	Created time.Time `json:"created"`
}

type ForkOptions struct {
	At string
}
