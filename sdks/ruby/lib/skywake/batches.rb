module Skywake
  module Batches
    module_function

    def split(items, most, bytes)
      batches = []
      batch = []
      size = 0
      items.each do |item|
        weight = yield(item)
        if batch.size == most || (!batch.empty? && size + weight > bytes)
          batches << batch
          batch = []
          size = 0
        end
        batch << item
        size += weight
      end
      batches << batch unless batch.empty?
      batches
    end
  end
end
