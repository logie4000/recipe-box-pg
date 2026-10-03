require "rails_helper"

RSpec.describe Tenancy do
  it "reads the alias-only organization claim" do
    expect(described_class.organizations_from("organization" => [ "acme" ])).to eq([ { id: nil, alias: "acme" } ])
  end

  it "reads the organization claim with ids" do
    claims = { "organization" => { "acme" => { "id" => "11111111-1111-4111-8111-111111111111" } } }
    expect(described_class.organizations_from(claims)).to eq([ { id: "11111111-1111-4111-8111-111111111111", alias: "acme" } ])
  end

  it "is off by default" do
    expect(described_class.enabled?).to be(false)
  end
end
