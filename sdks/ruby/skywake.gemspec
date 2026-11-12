require_relative "lib/skywake/version"

Gem::Specification.new do |spec|
  spec.name = "skywake"
  spec.version = Skywake::VERSION
  spec.summary = "Vector, full-text and hybrid search on your own S3 bucket"
  spec.description = "Skywake for Ruby: vector, BM25 and hybrid search over indexes that live in your own object storage and branch like git. No dependencies."
  spec.homepage = "https://skywake.dev"
  spec.metadata = {
    "homepage_uri" => "https://skywake.dev",
    "documentation_uri" => "https://skywake.dev/docs",
    "source_code_uri" => "https://github.com/skywakehq/skywake/tree/HEAD/sdks/ruby",
    "bug_tracker_uri" => "https://github.com/skywakehq/skywake/issues",
  }
  spec.authors = ["Skywake"]
  spec.license = "Apache-2.0"
  spec.files = Dir["lib/**/*.rb", "README.md"]
  spec.required_ruby_version = ">= 2.6"
end
