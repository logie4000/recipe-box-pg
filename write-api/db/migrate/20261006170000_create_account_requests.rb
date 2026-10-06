# Sign-up with approval. Anyone can register in Keycloak, but a new account
# has no app role, so it can only browse. When it first signs in, the web app
# files a request here; an admin approves it (Keycloak grants "reader") or
# declines it (Keycloak disables the account), and the row goes.
#
# RLS: a user sees only their own request; an admin (app.is_admin = 'on',
# set from the token's admin role by both APIs) sees and removes all of them.
class CreateAccountRequests < ActiveRecord::Migration[8.1]
  def up
    create_table :account_requests do |t|
      t.string :user_sub, null: false, index: { unique: true }
      t.string :email
      t.string :name
      t.timestamps
    end

    execute <<~SQL
      ALTER TABLE account_requests ENABLE ROW LEVEL SECURITY;
      ALTER TABLE account_requests FORCE ROW LEVEL SECURITY;
      CREATE POLICY account_requests_own ON account_requests
        USING (user_sub = NULLIF(current_setting('app.user_id', true), ''))
        WITH CHECK (user_sub = NULLIF(current_setting('app.user_id', true), ''));
      CREATE POLICY account_requests_admin ON account_requests
        USING (current_setting('app.is_admin', true) = 'on');
    SQL
  end

  def down
    drop_table :account_requests
  end
end
