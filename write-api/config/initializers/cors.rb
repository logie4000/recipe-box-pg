# Browser and mobile (Capacitor) origins allowed to call the write API.
# Same variable as the Go read-api. Comma separated.
origins = ENV.fetch("CORS_ALLOWED_ORIGINS", "http://localhost:4200,capacitor://localhost,https://localhost")
  .split(",").map(&:strip).reject(&:empty?)

Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins(*origins)
    resource "/api/*",
      headers: %w[Authorization Content-Type X-Client-Version X-Tenant-Id X-Request-Id],
      methods: %i[post put patch delete options head],
      max_age: 600
  end
end
