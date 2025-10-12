defmodule NukeApi.Repo.Migrations.CreateVehicles do
  use Ecto.Migration

  def up do
    # Create vehicles table only if it does not already exist (idempotent for Supabase-managed DB)
    execute """
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'vehicles'
      ) THEN
        CREATE TABLE vehicles (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          make text NOT NULL,
          model text NOT NULL,
          year integer NOT NULL,
          vin text,
          license_plate text,
          color text,
          mileage integer,
          engine_type text,
          transmission text,
          drivetrain text,
          status text NOT NULL DEFAULT 'active',
          verified boolean NOT NULL DEFAULT false,
          owner_id uuid,
          metadata jsonb DEFAULT '{}'::jsonb,
          inserted_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS vehicles_vin_index ON vehicles(vin);
        CREATE INDEX IF NOT EXISTS vehicles_owner_id_index ON vehicles(owner_id);
        CREATE INDEX IF NOT EXISTS vehicles_make_model_index ON vehicles(make, model);
        CREATE INDEX IF NOT EXISTS vehicles_status_index ON vehicles(status);
      END IF;
    END$$;
    """
  end

  def down do
    # Only drop if this table looks like the legacy Ecto-managed version (has owner_id but not user_id)
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
        DROP TABLE IF EXISTS vehicles CASCADE;
      END IF;
    END$$;
    """
  end
end
