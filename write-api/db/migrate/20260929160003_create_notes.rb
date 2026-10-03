# Example resource: written by write-api, read by read-api (GET /api/v1/notes).
class CreateNotes < ActiveRecord::Migration[8.1]
  def change
    create_table :notes do |t|
      t.string :title, null: false
      t.text :body, null: false, default: ""
      t.string :author_sub, null: false
      t.timestamps
    end
    add_index :notes, :created_at
  end
end
