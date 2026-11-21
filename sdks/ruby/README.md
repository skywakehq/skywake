# Skywake for Ruby

Shared disks you fork, merge and search. Standard library only.

```ruby
require "skywake"

sky = Skywake.new

app = sky.create_disk("app", search: true)
work = app.fork("agent-1")
work.write({ "notes.md" => "hello" }, message: "add notes")
work.read("notes.md")
work.merge_into("main")
app.query("notes", limit: 5)
```

The key comes from `key:`, then `SKYWAKE_API_KEY`, then the profile `skywake login` saved.
Lists such as `sky.list_disks` and `app.log` are lazy `Enumerator`s. Errors are
`Skywake::Error` subclasses: `AuthError`, `PermissionError`, `NotFound`, `Conflict`,
`MergeConflict` (`#conflicts`), `InvalidRequest`, `RateLimited` (`#retry_after`) and `ServerError`.

Tests: `rake`, or `ruby -Ilib -Itest -e 'Dir["test/*_test.rb"].each { |f| require_relative f }'`.
