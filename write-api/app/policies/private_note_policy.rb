# Anyone signed in may keep private notes. Which rows they can touch is
# enforced by the row-level-security policy on private_notes, not here.
class PrivateNotePolicy < ApplicationPolicy
  def create? = user.reader?
  def destroy? = user.reader?
end
