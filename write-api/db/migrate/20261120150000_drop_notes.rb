# The template's Notes example (a page where every signed-in user could read
# every note) isn't part of Recipe Box. Drops its two tables and their data.
class DropNotes < ActiveRecord::Migration[8.1]
  def up
    drop_table :notes
    drop_table :private_notes
  end

  def down
    raise ActiveRecord::IrreversibleMigration
  end
end
