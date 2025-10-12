defmodule NukeApi.Repo.Migrations.FixOwnershipVerificationsTable do
  use Ecto.Migration

  def up do
    execute """
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name='ownership_verifications'
        AND column_name='verification_type'
      ) THEN
        ALTER TABLE ownership_verifications ADD COLUMN verification_type VARCHAR(255) DEFAULT 'title';
      END IF;
    END $$;
    """

    # Add indexes if they don't exist
    execute "CREATE INDEX IF NOT EXISTS idx_ownership_verifications_verification_type ON ownership_verifications(verification_type);"
    execute "CREATE INDEX IF NOT EXISTS idx_ownership_verifications_status_verification_type ON ownership_verifications(status, verification_type);"
  end

  def down do
    drop_if_exists index(:ownership_verifications, [:verification_type])
    drop_if_exists index(:ownership_verifications, [:status, :verification_type])

    execute """
    DO $$
    BEGIN
      IF EXISTS (
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name='ownership_verifications'
        AND column_name='verification_type'
      ) THEN
        ALTER TABLE ownership_verifications DROP COLUMN verification_type;
      END IF;
    END $$;
    """
  end
end
