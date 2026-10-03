FactoryBot.define do
  factory :note do
    sequence(:title) { |n| "Note #{n}" }
    body { "Body" }
    author_sub { "seed" }
  end
end
