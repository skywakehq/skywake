package skywake

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

const DefaultURL = "https://api.skywake.dev"

var (
	tableLine = regexp.MustCompile(`^\[\s*([^\]]+?)\s*\]$`)
	pairLine  = regexp.MustCompile(`^([A-Za-z_]+)\s*=\s*"((?:[^"\\]|\\.)*)"$`)
	versioned = regexp.MustCompile(`/v[12]$`)
)

type profile map[string]string

func firstSet(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func resolve(c *config) error {
	given := firstSet(c.key, os.Getenv("SKYWAKE_API_KEY"), os.Getenv("SKYWAKE_KEY"))
	var p profile
	if given == "" {
		p = readProfile(firstSet(c.profile, os.Getenv("SKYWAKE_PROFILE"), "default"))
	}
	c.key = firstSet(given, p["key"])
	if c.key == "" {
		return errors.New("no Skywake API key: run `skywake login`, set SKYWAKE_API_KEY, or pass skywake.WithKey")
	}
	url := firstSet(c.url, os.Getenv("SKYWAKE_URL"), p["url"], DefaultURL)
	c.url = versioned.ReplaceAllString(strings.TrimRight(url, "/"), "")
	c.environment = firstSet(c.environment, os.Getenv("SKYWAKE_ENV"), p["environment"])
	return nil
}

func credentialsPath() string {
	if appData := os.Getenv("APPDATA"); runtime.GOOS == "windows" && appData != "" {
		return filepath.Join(appData, "skywake", "credentials.toml")
	}
	base := os.Getenv("XDG_CONFIG_HOME")
	if base == "" {
		home := os.Getenv("HOME")
		if home == "" {
			return ""
		}
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "skywake", "credentials.toml")
}

func readProfile(name string) profile {
	path := credentialsPath()
	if path == "" {
		return nil
	}
	text, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	return parseCredentials(string(text))[name]
}

func parseCredentials(text string) map[string]profile {
	profiles := map[string]profile{}
	var current profile
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if table := tableLine.FindStringSubmatch(line); table != nil {
			if profiles[table[1]] == nil {
				profiles[table[1]] = profile{}
			}
			current = profiles[table[1]]
			continue
		}
		pair := pairLine.FindStringSubmatch(line)
		if pair == nil || current == nil || !strings.Contains(" key url environment ", " "+pair[1]+" ") {
			continue
		}
		var value string
		if json.Unmarshal([]byte(`"`+pair[2]+`"`), &value) == nil {
			current[pair[1]] = value
		}
	}
	return profiles
}
