package skywake_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	skywake "github.com/skywakehq/skywake/sdks/go"
)

func isolate(t *testing.T) func(text string) {
	for _, name := range []string{"SKYWAKE_API_KEY", "SKYWAKE_KEY", "SKYWAKE_URL", "SKYWAKE_ENV", "SKYWAKE_PROFILE", "APPDATA"} {
		t.Setenv(name, "")
	}
	dir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", dir)
	return func(text string) {
		folder := filepath.Join(dir, "skywake")
		os.MkdirAll(folder, 0o755)
		os.WriteFile(filepath.Join(folder, "credentials.toml"), []byte(text), 0o600)
	}
}

func echo(t *testing.T) *api {
	return fake(t, func(seen, int) reply {
		return reply{body: map[string]any{"organization": "o", "environment": "prod"}}
	})
}

func last(a *api) seen {
	all := a.requests()
	return all[len(all)-1]
}

func TestWithNothingSetTheErrorSaysHowToSignIn(t *testing.T) {
	isolate(t)
	_, err := skywake.New()
	if err == nil || !strings.Contains(err.Error(), "skywake login") {
		t.Fatalf("got %v", err)
	}
}

func TestTheKeyAndURLComeFromTheEnvironmentAndTheURLDefaultsToTheCloud(t *testing.T) {
	isolate(t)
	t.Setenv("SKYWAKE_API_KEY", "sw_env")
	same(t, must(skywake.New()).URL, "https://api.skywake.dev")
	t.Setenv("SKYWAKE_URL", "http://localhost:8080/")
	same(t, must(skywake.New()).URL, "http://localhost:8080")
}

func TestAProfileFromTheCredentialsFileIsUsedWhenNoKeyIsGiven(t *testing.T) {
	write := isolate(t)
	a := echo(t)
	write("[default]\nkey = \"sw_file\"\nurl = \"" + a.url + "\"\nenvironment = \"prod\"\n\n" +
		"[staging]\nkey = \"sw_staging\"\nurl = \"" + a.url + "\"\n")
	me := must(must(skywake.New()).Whoami(ctx))
	same(t, me.Environment, "prod")
	got := last(a)
	same(t, []string{got.headers.Get("authorization"), got.headers.Get("skywake-environment"), got.path},
		[]string{"Bearer sw_file", "prod", "/v2/whoami"})

	t.Setenv("SKYWAKE_PROFILE", "staging")
	must(must(skywake.New()).Whoami(ctx))
	got = last(a)
	same(t, []string{got.headers.Get("authorization"), got.headers.Get("skywake-environment")}, []string{"Bearer sw_staging", ""})
}

func TestCodeBeatsTheEnvironmentWhichBeatsTheFile(t *testing.T) {
	write := isolate(t)
	a := echo(t)
	write("[default]\nkey = \"sw_file\"\nurl = \"http://127.0.0.1:1\"\n")
	t.Setenv("SKYWAKE_API_KEY", "sw_env")
	t.Setenv("SKYWAKE_URL", a.url)
	must(must(skywake.New(skywake.WithEnvironment("staging"))).Whoami(ctx))
	same(t, []string{last(a).headers.Get("authorization"), last(a).headers.Get("skywake-environment")}, []string{"Bearer sw_env", "staging"})
	must(must(skywake.New(skywake.WithKey("sw_code"), skywake.WithURL(a.url))).Whoami(ctx))
	same(t, last(a).headers.Get("authorization"), "Bearer sw_code")
}
