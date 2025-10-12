defmodule NukeApi.Repo.Migrations.FixVehicleDocumentsSchema do
  use Ecto.Migration

  def change do
    # The database has both created_at/updated_at (timestamptz) and inserted_at (timestamp)
    # The Ecto schema doesn't declare timestamp fields, which is correct given this setup
    # Remove the redundant inserted_at column since created_at serves the same purpose

    alter table(:vehicle_documents) do
      remove :inserted_at
    end

    # Ensure proper indexes exist for performance
    create_if_not_exists index(:vehicle_documents, [:created_at])
    create_if_not_exists index(:vehicle_documents, [:updated_at])
  end
end
