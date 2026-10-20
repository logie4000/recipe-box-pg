require "rails_helper"
require Rails.root.join("lib/middleware/path_prefix")

RSpec.describe PathPrefix do
  it "puts the path nginx stripped back in front of SCRIPT_NAME" do
    seen = nil
    app = described_class.new(->(env) { seen = env.slice("SCRIPT_NAME", "PATH_INFO"); [ 200, {}, [] ] }, "/recipe-box")

    app.call(Rack::MockRequest.env_for("/admin/login"))

    expect(seen).to eq("SCRIPT_NAME" => "/recipe-box", "PATH_INFO" => "/admin/login")
  end
end
