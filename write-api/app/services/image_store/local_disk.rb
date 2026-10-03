module ImageStore
  # Files on a local disk or a volume shared with the read-api container.
  class LocalDisk
    attr_reader :root

    def initialize(root)
      @root = Pathname(root)
    end

    def write(key, bytes)
      path = path_for(key)
      FileUtils.mkdir_p(path.dirname)
      File.binwrite(path, bytes)
    end

    def delete(key)
      FileUtils.rm_f(path_for(key))
    end

    def exist?(key) = path_for(key).file?

    private
      def path_for(key)
        raise ArgumentError, "invalid image key" unless ImageStore.valid_key?(key)

        root.join(key)
      end
  end
end
