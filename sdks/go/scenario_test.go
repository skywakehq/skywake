package skywake_test

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"testing"
	"time"

	skywake "github.com/skywakehq/skywake/sdks/go"
)

type scenarioKeys struct{ prod, staging, read string }

func scenarioSetup(t *testing.T, url, admin string) scenarioKeys {
	org := must(skywake.New(skywake.WithURL(url), skywake.WithKey(admin)))
	for _, name := range []string{"prod", "staging"} {
		var conflict *skywake.Conflict
		if _, err := org.CreateEnvironment(ctx, name); err != nil && !errors.As(err, &conflict) {
			t.Fatal(err)
		}
	}
	made := func(name, role, environment string) string {
		return must(org.CreateKey(ctx, skywake.NewKey{Name: name, Role: role, Environment: environment})).Key
	}
	keys := scenarioKeys{made("prod", "admin", "prod"), made("staging", "admin", "staging"), made("reader", "read", "prod")}
	for _, name := range []string{"SKYWAKE_KEY", "SKYWAKE_ENV", "SKYWAKE_PROFILE"} {
		t.Setenv(name, "")
	}
	t.Setenv("SKYWAKE_URL", url)
	t.Setenv("SKYWAKE_API_KEY", keys.prod)
	return keys
}

func eventually[T any](check func() (T, bool)) T {
	for tries := 0; ; tries++ {
		found, ok := check()
		if ok || tries == 100 {
			return found
		}
		time.Sleep(200 * time.Millisecond)
	}
}

func names[T any](items []T, name func(T) string) []string {
	out := []string{}
	for _, item := range items {
		out = append(out, name(item))
	}
	return out
}

func failsWith[E error](t *testing.T, err error) E {
	t.Helper()
	var target E
	if !errors.As(err, &target) {
		t.Fatalf("want %T, got %v", target, err)
	}
	return target
}

func TestScenarios(t *testing.T) {
	url, admin := os.Getenv("SKYWAKE_SCENARIO_URL"), os.Getenv("SKYWAKE_SCENARIO_KEY")
	if url == "" || admin == "" {
		t.Skip("needs SKYWAKE_SCENARIO_URL and SKYWAKE_SCENARIO_KEY")
	}
	keys := scenarioSetup(t, url, admin)
	sky := must(skywake.New())
	app := sky.Disk("app")

	t.Run("01 with only SKYWAKE_API_KEY set, whoami shows the environment", func(t *testing.T) {
		me := must(sky.Whoami(ctx))
		same(t, []string{me.Environment, me.Role}, []string{"prod", "admin"})
	})

	t.Run("02 a file written to a new disk reads back and is listed", func(t *testing.T) {
		must(app.Write(ctx, "README.md", []byte("# App\n")))
		same(t, must(app.Read(ctx, "README.md")), "# App\n")
		listed := must(app.List(ctx, ""))
		same(t, names(listed, func(e skywake.Entry) string { return e.Path + ":" + e.Kind }), []string{"README.md:file"})
	})

	t.Run("03 many files written together are one commit", func(t *testing.T) {
		before := len(must(skywake.Collect(app.Log(ctx))))
		must(app.WriteFiles(ctx, map[string][]byte{
			"src/a.ts":  []byte("export const a = 1;\n"),
			"src/b.ts":  []byte("export const b = 2;\n"),
			"notes.txt": []byte("hi"),
		}, skywake.WriteOptions{Message: "three files"}))
		log := must(skywake.Collect(app.Log(ctx)))
		same(t, []any{len(log), log[0].Message}, []any{before + 1, "three files"})
	})

	t.Run("04 both sides changing one file make the merge a MergeConflict", func(t *testing.T) {
		work := must(app.Fork(ctx, "agent-1"))
		must(work.Write(ctx, "notes.txt", []byte("from the agent")))
		must(app.Write(ctx, "notes.txt", []byte("from main")))
		_, err := work.MergeInto(ctx, "main")
		same(t, failsWith[*skywake.MergeConflict](t, err).Conflicts, []string{"notes.txt"})
		settled := must(work.MergeInto(ctx, "main", skywake.MergeOptions{Prefer: "theirs"}))
		if settled.Commit == "" {
			t.Fatal("no commit")
		}
		same(t, must(app.Read(ctx, "notes.txt")), "from the agent")
	})

	t.Run("05 grep, find and query on a disk find a file", func(t *testing.T) {
		must(app.Write(ctx, "docs/coffee.md", []byte("How to brew coffee at home.\n")))
		lines := must(app.Grep(ctx, "brew"))
		same(t, names(lines, func(m skywake.Match) string { return m.Path + ":" + strconv.Itoa(m.Line) }), []string{"docs/coffee.md:1"})
		found := must(app.Find(ctx, "*.md", skywake.FindOptions{Path: "docs"}))
		same(t, names(found, func(f skywake.Found) string { return f.Path }), []string{"docs/coffee.md"})
		hits := eventually(func() ([]skywake.FileHit, bool) {
			hits := must(app.Query(ctx, "coffee"))
			for _, hit := range hits {
				if hit.Path == "docs/coffee.md" {
					return hits, true
				}
			}
			return hits, false
		})
		same(t, hits[0].Path, "docs/coffee.md")
	})

	t.Run("06 read with at returns the old content after a change", func(t *testing.T) {
		old := must(app.Head(ctx))
		must(app.Write(ctx, "README.md", []byte("# App, changed\n")))
		same(t, must(app.Read(ctx, "README.md", skywake.ReadOptions{At: old})), "# App\n")
		same(t, must(app.Read(ctx, "README.md")), "# App, changed\n")
	})

	t.Run("07 keys stay in their environment and their role", func(t *testing.T) {
		staging := must(skywake.New(skywake.WithKey(keys.staging), skywake.WithEnvironment("prod")))
		_, err := staging.Disk("app").Read(ctx, "README.md")
		failsWith[*skywake.PermissionError](t, err)
		reader := must(skywake.New(skywake.WithKey(keys.read)))
		same(t, must(reader.Disk("app").Read(ctx, "README.md")), "# App, changed\n")
		_, err = reader.Disk("app").Write(ctx, "x.md", []byte("nope"))
		failsWith[*skywake.PermissionError](t, err)
	})

	t.Run("08 a wrong name is NotFound with a suggestion", func(t *testing.T) {
		_, err := sky.Disk("ap").Read(ctx, "README.md")
		if hint := failsWith[*skywake.NotFound](t, err).Hint; !regexp.MustCompile("`app`").MatchString(hint) {
			t.Fatalf("hint %q", hint)
		}
	})

	t.Run("09 destroying a branch, then the disk, empties the list", func(t *testing.T) {
		if err := app.On("agent-1").Destroy(ctx); err != nil {
			t.Fatal(err)
		}
		same(t, names(must(app.Branches(ctx)), func(b skywake.Branch) string { return b.Name }), []string{"main"})
		if err := app.Destroy(ctx); err != nil {
			t.Fatal(err)
		}
		same(t, len(must(skywake.Collect(sky.ListDisks(ctx)))), 0)
	})

	t.Run("10 a folder goes up as one commit and comes back the same", func(t *testing.T) {
		dir := t.TempDir()
		os.WriteFile(filepath.Join(dir, "a.txt"), []byte("alpha"), 0o644)
		os.WriteFile(filepath.Join(dir, "b.bin"), []byte{0, 1, 2, 255}, 0o644)
		site := sky.Disk("site")
		must(site.Upload(ctx, dir, skywake.UploadOptions{Message: "site"}))
		back := t.TempDir()
		must(site.Download(ctx, back))
		same(t, string(must(os.ReadFile(filepath.Join(back, "a.txt")))), "alpha")
		same(t, must(os.ReadFile(filepath.Join(back, "b.bin"))), []byte{0, 1, 2, 255})
		if err := site.Destroy(ctx); err != nil {
			t.Fatal(err)
		}
	})
}
