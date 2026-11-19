# Skywake for Ruby

The Ruby client for Skywake, the open-source search index on your own bucket: vector and full-text
search, filters and aggregates, with indexes you can fork and merge. Standard library only.

```ruby
require "skywake"

sky = Skywake.new

products = sky.index("products")
products.upsert({ id: "mug", text: "a blue coffee mug", price: 12 })
products.query("coffee", filter: { price: { lt: 20 } }, limit: 5)

draft = products.fork("draft")
draft.update("mug", { price: 9 })
draft.merge_into("main")
```

The key comes from `key:`, then `SKYWAKE_API_KEY`, then the profile `skywake login` saved.
Lists such as `sky.list_indexes` and `products.rows` are lazy `Enumerator`s. Errors are
`Skywake::Error` subclasses: `AuthError`, `PermissionError`, `NotFound`, `Conflict`,
`MergeConflict` (`#conflicts`), `InvalidRequest`, `RateLimited` (`#retry_after`) and `ServerError`.

Tests: `rake`, or `ruby -Ilib -Itest -e 'Dir["test/*_test.rb"].each { |f| require_relative f }'`.
