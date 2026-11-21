# Any signed-in user may ask to be let in, and verify their own email (a
# verified email is let in at once, see AccountRequestsController); otherwise
# only admins decide.
class AccountRequestPolicy < ApplicationPolicy
  def create? = true
  def code? = true
  def verify? = true
  def approve? = user.admin?
  def destroy? = user.admin?
end
