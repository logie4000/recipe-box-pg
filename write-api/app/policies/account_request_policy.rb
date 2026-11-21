# Any signed-in user may ask to be let in (a verified email is let in at once,
# see AccountRequestsController#create); otherwise only admins decide.
class AccountRequestPolicy < ApplicationPolicy
  def create? = true
  def approve? = user.admin?
  def destroy? = user.admin?
end
