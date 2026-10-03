# Example of per-user rows with Postgres row-level security. Both APIs set
# app.user_id (the token sub) at the start of each request transaction; the
# policy fails closed when it is unset.
class CreatePrivateNotes < ActiveRecord::Migration[8.1]
  def up
    create_table :private_notes do |t|
      t.string :owner_sub, null: false
      t.text :body, null: false
      t.timestamps
    end
    add_index :private_notes, %i[owner_sub created_at]

    execute <<~SQL
      ALTER TABLE private_notes ENABLE ROW LEVEL SECURITY;
      ALTER TABLE private_notes FORCE ROW LEVEL SECURITY;
      CREATE POLICY private_notes_owner ON private_notes
        USING (owner_sub = current_setting('app.user_id', true))
        WITH CHECK (owner_sub = current_setting('app.user_id', true));
    SQL
  end

  def down
    drop_table :private_notes
  end
end
