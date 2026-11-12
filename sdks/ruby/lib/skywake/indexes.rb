require "skywake/paging"
require "skywake/routes"

module Skywake
  # A body sent as it is, with its nulls; `Client#call` leaves out nils.
  class Exact
    def initialize(body)
      @body = body
    end

    def to_json(*args)
      @body.to_json(*args)
    end
  end

  # The organization's indexes.
  class Indexes
    include Enumerable

    def initialize(sky)
      @sky = sky
    end

    # Makes an index with an empty `main` branch. `vectors` is a list of
    # {"name", "dims", "metric", "element"}, plus {"embed" => {"model" =>
    # "..."}} to give that vector as text; `attributes` of {"name", "type"}.
    # `shards` splits the documents (1 by default); `kms_key_id` is a key in
    # your cloud's key service that encrypts the index. `id_type: "uuid"`
    # makes every id a UUID, returned lowercase with dashes; by default an id
    # is a string or a whole number. `replicas` pins the index to that many
    # servers, billed per GB-hour instead of per query.
    def create(name, vectors: [], attributes: [], region: nil, shards: nil, kms_key_id: nil, id_type: nil,
               replicas: nil)
      schema = { vectors: vectors, attributes: attributes, id: id_type }.compact
      @sky.call(:post, "/indexes", body: { name: name, schema: schema, region: region, shards: shards,
                                           encryption: Routes.encryption(kms_key_id),
                                           pinned: Routes.pinned(replicas) })
      SearchIndex.new(@sky, name)
    end

    # One page of indexes, in name order.
    def list(limit: nil, after: nil)
      @sky.call(:get, "/indexes", params: { limit: limit, after: after })
    end

    # Every index, a page at a time.
    def each(&block)
      Skywake.every("name") { |limit, after| list(limit: limit, after: after) }.each(&block)
    end

    # The schema, and the counts of `main`.
    def get(name)
      @sky.call(:get, Routes.index(name))
    end

    # Queries, writes and size per day over the last `days` days (14 by
    # default), oldest first.
    def usage(name, days: nil)
      @sky.call(:get, "#{Routes.index(name)}/usage", params: { days: days })["days"]
    end

    # Adds `attributes` ({"name", "type"} each), or makes the index
    # read-only or writable again, on every branch. An attribute it has must
    # keep its type.
    # `retention_days` is how long older versions stay after they were
    # replaced; `:all` keeps every one. `replicas` pins the index to that many
    # servers; `:none` unpins it.
    def update(name, attributes: nil, read_only: nil, retention_days: nil, replicas: nil)
      body = { attributes: attributes, read_only: read_only, retention_days: retention_days,
               pinned: Routes.pinned(replicas) }.compact
      body[:retention_days] = nil if retention_days == :all
      body[:pinned] = nil if replicas == :none
      @sky.call(:patch, Routes.index(name), body: Exact.new(body))
    end

    # Deletes the index, every branch and all its data.
    def delete(name)
      @sky.call(:delete, Routes.index(name))
      nil
    end
  end
end
