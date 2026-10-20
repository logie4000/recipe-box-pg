# When the site is served under a path (APP_PATH=/recipe-box), nginx strips it
# before requests reach this app, so they arrive as /admin/... Putting the
# prefix back in SCRIPT_NAME makes Rails' links and redirects include it.
class PathPrefix
  def initialize(app, prefix)
    @app = app
    @prefix = prefix
  end

  def call(env)
    env["SCRIPT_NAME"] = "#{@prefix}#{env["SCRIPT_NAME"]}"
    @app.call(env)
  end
end
