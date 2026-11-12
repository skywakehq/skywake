module Skywake
  # The most documents or ids the API takes in one request, and in one page.
  BATCH = 1000

  # Every item of a list, a page at a time until a short one.
  # `page.call(limit, after)` gives one page; `key` is what the next comes after.
  def self.every(key, &page)
    Enumerator.new do |out|
      after = nil
      loop do
        items = page.call(BATCH, after)
        items.each { |item| out << item }
        break if items.size < BATCH

        after = items.last.fetch(key)
      end
    end
  end
end
