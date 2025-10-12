defmodule NukeApi.Repo.Migrations.CreateVehicleImages do
  use Ecto.Migration

  def up do
    execute """
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'vehicle_images'
      ) THEN
        CREATE TABLE vehicle_images (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          url text NOT NULL,
          thumbnail_url text,
          category text NOT NULL DEFAULT 'general',
          position integer NOT NULL DEFAULT 0,
          is_primary boolean NOT NULL DEFAULT false,
          width integer,
          height integer,
          file_size integer,
          file_type text,
          alt_text text,
          uploaded_by uuid,
          metadata jsonb DEFAULT '{}'::jsonb,
          inserted_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS vehicle_images_vehicle_id_index ON vehicle_images(vehicle_id);
        CREATE INDEX IF NOT EXISTS vehicle_images_category_index ON vehicle_images(category);
        CREATE INDEX IF NOT EXISTS vehicle_images_is_primary_index ON vehicle_images(is_primary);
        CREATE INDEX IF NOT EXISTS vehicle_images_uploaded_by_index ON vehicle_images(uploaded_by);
        CREATE UNIQUE INDEX IF NOT EXISTS unique_primary_image_per_vehicle
          ON vehicle_images(vehicle_id, is_primary)
          WHERE is_primary = true;
      END IF;
    END$$;
    """
  end

  def down do
    # Only drop if table exists and matches legacy structure; otherwise leave it
    execute """
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'vehicle_images'
      ) THEN
        DROP TABLE IF EXISTS vehicle_images CASCADE;
      END IF;
    END$$;
    """
  end
end
