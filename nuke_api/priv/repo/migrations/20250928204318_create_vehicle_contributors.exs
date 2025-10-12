defmodule NukeApi.Repo.Migrations.CreateVehicleContributors do
  use Ecto.Migration

  def change do
    create table(:vehicle_contributors, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :vehicle_id, references(:vehicles, on_delete: :delete_all, type: :binary_id), null: false
      add :user_id, references(:profiles, on_delete: :delete_all, type: :binary_id), null: false
      add :role, :string, null: false # owner, previous_owner, restorer, contributor, mechanic, etc.
      add :status, :string, null: false, default: "active" # active, inactive, pending
      add :contribution_summary, :text
      add :start_date, :date
      add :end_date, :date
      add :verified, :boolean, default: false
      add :verified_at, :utc_datetime
      add :verified_by, references(:profiles, type: :binary_id)
      add :metadata, :map, default: %{}

      timestamps()
    end

    create index(:vehicle_contributors, [:vehicle_id])
    create index(:vehicle_contributors, [:user_id])
    create index(:vehicle_contributors, [:role])
    create index(:vehicle_contributors, [:status])
    create unique_index(:vehicle_contributors, [:vehicle_id, :user_id, :role])
  end
end
