defmodule NukeApi.Repo.Migrations.CreateVehicleUserPermissions do
  use Ecto.Migration

  def change do
    create table(:vehicle_user_permissions, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :vehicle_id, references(:vehicles, on_delete: :delete_all, type: :binary_id), null: false
      add :user_id, references(:profiles, on_delete: :delete_all, type: :binary_id), null: false
      add :role, :string, null: false # owner, sales_agent, moderator, public_contributor, verified_contributor
      add :granted_at, :utc_datetime, null: false
      add :granted_by, references(:profiles, type: :binary_id)
      add :expires_at, :utc_datetime
      add :is_active, :boolean, default: true, null: false
      add :permissions, :map, default: %{}
      add :metadata, :map, default: %{}

      timestamps()
    end

    create index(:vehicle_user_permissions, [:vehicle_id])
    create index(:vehicle_user_permissions, [:user_id])
    create index(:vehicle_user_permissions, [:role])
    create index(:vehicle_user_permissions, [:is_active])
    create index(:vehicle_user_permissions, [:expires_at])
    create unique_index(:vehicle_user_permissions, [:vehicle_id, :user_id, :role])
  end
end