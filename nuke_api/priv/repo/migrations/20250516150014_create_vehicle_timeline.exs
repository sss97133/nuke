defmodule NukeApi.Repo.Migrations.CreateVehicleTimeline do
  use Ecto.Migration

  def change do
    # Create the vehicle_timeline table for immutable record-keeping
    create table(:vehicle_timeline, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :vehicle_id, references(:vehicles, type: :binary_id, on_delete: :delete_all), null: false
      
      # Event details
      add :event_type, :string, null: false
      add :event_date, :utc_datetime, null: false
      add :source, :string
      add :confidence_score, :float, default: 1.0
      
      # Event data
      add :title, :string, null: false
      add :description, :text
      add :location, :string
      
      # Ownership and verification
      add :creator_id, :binary_id
      add :verified, :boolean, default: false, null: false
      add :verifier_id, :binary_id
      
      # Additional data
      add :metadata, :map, default: %{}
      
      timestamps()
    end

    # Create indexes for efficient queries
    create index(:vehicle_timeline, [:vehicle_id])
    create index(:vehicle_timeline, [:event_type])
    create index(:vehicle_timeline, [:event_date])
    create index(:vehicle_timeline, [:creator_id])
    create index(:vehicle_timeline, [:verified])
  end
end
