Rails.application.routes.draw do
  # Health check for load balancers and uptime monitors.
  get "up" => "rails/health#show", as: :rails_health_check

  # JSON write API. One URL space, /api/v1/*, split by HTTP method: nginx (and
  # web/proxy.conf.mjs in dev) sends POST/PUT/PATCH/DELETE here and GET/HEAD to
  # the Go read-api. So this app defines no GET routes under /api.
  namespace :api do
    namespace :v1 do
      resources :notes, only: %i[create update destroy]
      resources :private_notes, only: %i[create destroy]
      resources :recipes, only: %i[create update destroy] do
        resource :image, only: %i[update destroy], controller: "recipe_images"
      end
    end
  end

  # Admin cookie-login hook (no admin UI shipped). OmniAuth middleware itself
  # handles POST /admin/auth/keycloak.
  namespace :admin do
    root "home#show"
    get "login", to: "sessions#new"
    get "auth/keycloak/callback", to: "sessions#create"
    get "auth/failure", to: "sessions#failure"
    delete "logout", to: "sessions#destroy"
  end
end
