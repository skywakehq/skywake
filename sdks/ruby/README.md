# Skywake for Ruby

Search indexes from Ruby: vectors, BM25, hybrid, sparse and late-interaction
scores, on branches you fork and merge. Standard library only.

```ruby
require "skywake"

sky = Skywake::Client.new(ENV["SKYWAKE_URL"], ENV["SKYWAKE_KEY"])
docs = sky.indexes.create("products",
  vectors: [{ name: "embedding", dims: 3 }],
  attributes: [{ name: "title", type: "text" }, { name: "price", type: "number" }])

docs.upsert([{ id: 1, vectors: { embedding: [0.1, 0.2, 0.3] }, attributes: { title: "Red mug", price: 9 } }])
docs.query("embedding", [0.1, 0.2, 0.3], top_k: 5, filter: { price: { lt: 10 } })
docs.search("mug", fields: ["title"])

trial = docs.fork("agents/try")   # nothing is copied
trial.delete_by(price: { gt: 100 })
docs.merge("agents/try")
```

Reads return an `Array` with `performance` and `billing`. Errors raise
`Skywake::Error` with `status`, `code`, `request_id` and, for a bad request,
the `path` of the field that is wrong. Failed requests are retried when that
is safe.

Tests: `rake`, or `ruby -Ilib -Itest -e 'Dir["test/*_test.rb"].each { |f| require File.expand_path(f) }'`.
