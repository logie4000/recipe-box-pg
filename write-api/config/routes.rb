Rails.application.routes.draw do
  # Health check for load balancers and uptime monitors.
  get "up" => "rails/health#show", as: :rails_health_check

  # JSON write API. nginx routes /api/w/* here; reads go to the Go read-api (/api/v1/*).
  namespace :api do
    namespace :w do
      namespace :v1 do
        resources :notes, only: %i[create update destroy]
        resources :private_notes, only: %i[create destroy]
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
