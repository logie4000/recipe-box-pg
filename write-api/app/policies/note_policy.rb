class NotePolicy < ApplicationPolicy
  # Editors may change any note; admins too (AuthUser#editor? includes admin).
end
