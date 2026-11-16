require_relative "lib/skywake/version"

Gem::Specification.new do |spec|
  spec.name = "skywake"
  spec.version = Skywake::VERSION
  spec.summary = "Files with branches and search indexes, for AI agents"
  spec.description = "Skywake for Ruby: disks you fork and merge, and indexes you upsert to and query. No dependencies."
  spec.homepage = "https://skywake.dev"
  spec.metadata = {
    "homepage_uri" => "https://skywake.dev",
    "documentation_uri" => "https://skywake.dev/docs",
    "source_code_uri" => "https://github.com/skywakehq/skywake/tree/HEAD/sdks/ruby",
    "bug_tracker_uri" => "https://github.com/skywakehq/skywake/issues"
  }
  spec.authors = ["Skywake"]
  spec.license = "Apache-2.0"
  spec.files = Dir["lib/**/*.rb", "README.md"]
  spec.required_ruby_version = ">= 3.0"
end
