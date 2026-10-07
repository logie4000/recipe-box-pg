# bin/rails images:copy FROM=local TO=s3
#
# Copies recipe photos from one ImageStore backend to another, skipping any
# already there, so it can be run again safely. Moving to S3: run it while the
# apps still use local storage, switch both to IMAGE_STORAGE=s3, then run it
# once more to pick up photos uploaded in between. Nothing is deleted from FROM.
namespace :images do
  desc "Copy recipe photos between storage backends (FROM=local TO=s3)"
  task copy: :environment do
    from, to = ENV.fetch("FROM", "local"), ENV.fetch("TO", "s3")
    abort "FROM and TO are both #{from}" if from == to

    result = ImageStore.copy(from: ImageStore.backend(from), to: ImageStore.backend(to), log: method(:puts))
    puts "#{result[:copied]} copied, #{result[:skipped]} already in #{to}"
  end
end
