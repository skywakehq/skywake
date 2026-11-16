require "fileutils"
require "find"

module Skywake
  module Folders
    module_function

    def local_files(root)
      found = []
      Find.find(root) do |file|
        if file != root && File.basename(file) == ".git"
          Find.prune
        elsif File.file?(file) && !File.symlink?(file)
          found << [file.delete_prefix("#{root}/"), file]
        end
      end
      found.sort
    end

    def inside(root, name)
      local = File.expand_path(File.join(*name.split("/")), root)
      raise ArgumentError, "`#{name}` is outside #{root}" unless local.start_with?(root + File::SEPARATOR)

      local
    end

    def link(local, target)
      File.unlink(local) if File.symlink?(local) || File.exist?(local)
      File.symlink(target, local)
    end

    def save(local, data, executable)
      File.binwrite(local, data)
      File.chmod(0o755, local) if executable
    end

    def executable?(file)
      File.stat(file).mode & 0o111 != 0
    end
  end
end
