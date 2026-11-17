package skywake

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"unicode/utf8"
)

const (
	commitCount = 10_000
	commitBytes = 32 * 1024 * 1024
	inlineMax   = 4 * 1024 * 1024
	partMax     = 16 * 1024 * 1024
)

type FileChange struct {
	Path       string    `json:"path"`
	Text       *string   `json:"text,omitempty"`
	Base64     string    `json:"base64,omitempty"`
	Parts      []string  `json:"parts,omitempty"`
	Delete     bool      `json:"delete,omitempty"`
	From       *FileFrom `json:"from,omitempty"`
	Executable *bool     `json:"executable,omitempty"`
}

type FileFrom struct {
	Path string `json:"path"`
	At   string `json:"at,omitempty"`
}

type uploader func(ctx context.Context, part []byte) (string, error)

func weight(path string, size int64) int {
	content := (size + 2) / 3 * 4
	if size > inlineMax {
		content = (size + partMax - 1) / partMax * 70
	}
	return len(path)*6 + 64 + int(content)
}

func asText(content []byte) (string, bool) {
	if !utf8.Valid(content) {
		return "", false
	}
	text := string(content)
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	encoder.Encode(text)
	return text, encoded.Len()-1 <= (len(content)+2)/3*4+2
}

func uploadParts(ctx context.Context, content []byte, upload uploader) ([]string, error) {
	parts := []string{}
	for offset := 0; offset < len(content); offset += partMax {
		part, err := upload(ctx, content[offset:min(offset+partMax, len(content))])
		if err != nil {
			return nil, err
		}
		parts = append(parts, part)
	}
	return parts, nil
}

func changeOf(ctx context.Context, path string, content []byte, upload uploader, executable *bool) (FileChange, error) {
	change := FileChange{Path: path, Executable: executable}
	if len(content) > inlineMax {
		parts, err := uploadParts(ctx, content, upload)
		change.Parts = parts
		return change, err
	}
	if text, ok := asText(content); ok {
		change.Text = &text
	} else {
		change.Base64 = base64.StdEncoding.EncodeToString(content)
	}
	return change, nil
}
