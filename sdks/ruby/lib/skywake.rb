require "skywake/version"
require "skywake/errors"
require "skywake/settings"
require "skywake/transport"
require "skywake/http"
require "skywake/batches"
require "skywake/handle"
require "skywake/index"
require "skywake/client"

module Skywake
  def self.new(**options)
    Client.new(**options)
  end
end
