package skywake_test

import (
	"errors"
	"os"
	"strconv"
	"strings"
	"testing"

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
	products := sky.Index("products")

	t.Run("01 with only SKYWAKE_API_KEY set, whoami shows the environment", func(t *testing.T) {
		me := must(sky.Whoami(ctx))
		same(t, []string{me.Environment, me.Role}, []string{"prod", "admin"})
	})

	t.Run("02 one row upserted to a new index with no schema is found by query", func(t *testing.T) {
		must(products.Upsert(ctx, skywake.Row{"id": "mug", "text": "a blue coffee mug", "price": 12, "tags": []string{"kitchen"}}))
		hits := must(products.Query(ctx, "coffee mug"))
		same(t, []any{hits[0]["id"], hits[0]["price"]}, []any{"mug", 12})
		if hits[0]["score"].(float64) <= 0 {
			t.Fatalf("score %v", hits[0]["score"])
		}
	})

	t.Run("03 10,000 rows upserted in one call are all counted", func(t *testing.T) {
		rows := make([]skywake.Row, 10_000)
		for i := range rows {
			text, tag := "invoice "+strconv.Itoa(i), "billing"
			if i%2 == 1 {
				text, tag = "running shoe number "+strconv.Itoa(i), "shoes"
			}
			rows[i] = skywake.Row{"id": "row-" + strconv.Itoa(i), "text": text, "price": i % 100, "tags": []string{tag}}
		}
		bulk := sky.Index("bulk")
		same(t, must(bulk.Upsert(ctx, rows...)).Count, 10_000)
		same(t, must(bulk.Count(ctx, nil)), 10_000)
		same(t, must(bulk.Count(ctx, skywake.Filter{"tags": skywake.Filter{"contains": "shoes"}})), 5_000)
	})

	t.Run("04 a query takes a filter, a limit and keywords mode", func(t *testing.T) {
		hits := must(sky.Index("bulk").Query(ctx, "shoe", skywake.QueryOptions{
			Mode: "keywords", Filter: skywake.Filter{"price": skywake.Filter{"lt": 10}}, Limit: 3,
		}))
		same(t, len(hits), 3)
		for _, hit := range hits {
			if hit["price"].(float64) >= 10 || !strings.Contains(hit["text"].(string), "shoe") {
				t.Fatalf("hit %v", hit)
			}
		}
	})

	t.Run("05 update shows in get; delete makes get nil", func(t *testing.T) {
		same(t, must(products.Update(ctx, "mug", skywake.Row{"price": 9})), 1)
		same(t, must(products.Get(ctx, "mug"))["price"], 9)
		same(t, must(products.Delete(ctx, "mug")), 1)
		if row := must(products.Get(ctx, "mug")); row != nil {
			t.Fatalf("still there: %v", row)
		}
	})

	t.Run("06 a fork changes apart from main, and merging brings the change", func(t *testing.T) {
		must(products.Upsert(ctx, skywake.Row{"id": "cup", "text": "a white coffee cup", "price": 5}))
		draft := must(products.Fork(ctx, "draft"))
		must(draft.Update(ctx, "cup", skywake.Row{"price": 7}))
		same(t, must(draft.Query(ctx, "coffee cup"))[0]["price"], 7)
		same(t, must(products.Query(ctx, "coffee cup"))[0]["price"], 5)
		must(draft.MergeInto(ctx, "main"))
		same(t, must(products.Get(ctx, "cup"))["price"], 7)
	})

	t.Run("07 keys stay in their environment and their role", func(t *testing.T) {
		staging := must(skywake.New(skywake.WithKey(keys.staging), skywake.WithEnvironment("prod")))
		_, err := staging.Index("products").Query(ctx, "coffee")
		failsWith[*skywake.PermissionError](t, err)
		reader := must(skywake.New(skywake.WithKey(keys.read)))
		same(t, must(reader.Index("products").Get(ctx, "cup"))["price"], 7)
		_, err = reader.Index("products").Upsert(ctx, skywake.Row{"id": "x", "text": "nope"})
		failsWith[*skywake.PermissionError](t, err)
	})

	t.Run("08 a wrong name is NotFound with a suggestion", func(t *testing.T) {
		_, err := sky.Index("prodcts").Query(ctx, "coffee")
		if hint := failsWith[*skywake.NotFound](t, err).Hint; !strings.Contains(hint, "products") {
			t.Fatalf("hint %q", hint)
		}
	})

	t.Run("09 destroying a branch, then the indexes, empties the list", func(t *testing.T) {
		if err := products.On("draft").Destroy(ctx); err != nil {
			t.Fatal(err)
		}
		same(t, names(must(products.Branches(ctx)), func(b skywake.Branch) string { return b.Name }), []string{"main"})
		for _, err := range []error{
			sky.Index("products").Destroy(ctx),
			sky.Index("bulk").Destroy(ctx),
		} {
			if err != nil {
				t.Fatal(err)
			}
		}
		indexes := must(skywake.Collect(sky.ListIndexes(ctx)))
		same(t, len(indexes), 0)
	})
}
