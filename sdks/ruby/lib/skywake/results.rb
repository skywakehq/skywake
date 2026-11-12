module Skywake
  # What a read returns: a list, with how long it took and where its reads
  # came from in `performance`, such as {"server_ms" => 3,
  # "cache_temperature" => "warm", "cache_hit_ratio" => 0.5}, and what it
  # counted toward the bill in `billing`, such as {"queries" => 1}.
  class Results < Array
    attr_reader :performance, :billing

    def initialize(items, performance = nil, billing = nil)
      super(items)
      @performance = performance
      @billing = billing
    end

    def self.of(answer, field)
      new(answer.fetch(field), answer["performance"], answer["billing"])
    end
  end
end
