Rails.application.routes.draw do
  # Health check for load balancers and uptime monitors.
  get "up" => "rails/health#show", as: :rails_health_check

  # JSON write API. One URL space, /api/v1/*, split by HTTP method: nginx (and
  # web/proxy.conf.mjs in dev) sends POST/PUT/PATCH/DELETE here and GET/HEAD to
  # the Go read-api. So this app defines no GET routes under /api.
  namespace :api do
    namespace :v1 do
      resources :recipes, only: %i[create update destroy] do
        resource :image, only: %i[update destroy], controller: "recipe_images"
      end
      # Same path as the read-api's GET /api/v1/saved-recipes.
      resources :saved_recipes, path: "saved-recipes", only: %i[create destroy]
      # The caller's shopping list; the read-api serves GET /api/v1/shopping-list.
      scope "shopping-list", as: :shopping_list do
        resources :recipes, controller: "shopping_list_recipes", param: :public_id, only: %i[create update destroy]
        delete "/", to: "shopping_list_recipes#clear", as: :clear
      end
      # Getting in: email verification, or an admin's approval (admins list
      # the requests on the read-api).
      resources :account_requests, path: "account-requests", only: %i[create destroy] do
        post :code, on: :collection
        post :verify, on: :collection
        post :approve, on: :member
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
