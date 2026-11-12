module Skywake
  # Paths and body parts that indexes and their branches share.
  module Routes
    module_function

    def index(name)
      "/indexes/#{Client.escape(name)}"
    end

    def encryption(kms_key_id)
      kms_key_id && { kms_key_id: kms_key_id }
    end

    def pinned(replicas)
      replicas && { replicas: replicas }
    end
  end
  private_constant :Routes
end
