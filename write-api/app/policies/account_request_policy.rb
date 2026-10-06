# Any signed-in user may ask to be let in; only admins decide.
class AccountRequestPolicy < ApplicationPolicy
  def create? = true
  def approve? = user.admin?
  def destroy? = user.admin?
end
