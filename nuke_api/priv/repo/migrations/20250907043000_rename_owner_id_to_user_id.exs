defmodule NukeApi.Repo.Migrations.RenameOwnerIdToUserId do
  use Ecto.Migration

  def up do
    execute """
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='vehicles' AND column_name='owner_id'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='vehicles' AND column_name='user_id'
      ) THEN
        ALTER TABLE vehicles RENAME COLUMN owner_id TO user_id;
      END IF;
    END$$;
    """

    # Drop old index if it exists
    execute "DROP INDEX IF EXISTS vehicles_owner_id_index;"
    # Create new index for user_id (idempotent)
    execute "CREATE INDEX IF NOT EXISTS vehicles_user_id_index ON vehicles(user_id);"
  end

  def down do
    execute """
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='vehicles' AND column_name='user_id'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='vehicles' AND column_name='owner_id'
      ) THEN
        ALTER TABLE vehicles RENAME COLUMN user_id TO owner_id;
      END IF;
    END$$;
    """

    execute "DROP INDEX IF EXISTS vehicles_user_id_index;"
    execute "CREATE INDEX IF NOT EXISTS vehicles_owner_id_index ON vehicles(owner_id);"
  end
end
