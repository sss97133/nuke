defmodule NukeApi.Repo.Migrations.CreateVinValidations do
  use Ecto.Migration

  def change do
    create table(:vin_validations, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :vehicle_id, references(:vehicles, on_delete: :delete_all, type: :binary_id), null: false
      add :user_id, references(:profiles, on_delete: :delete_all, type: :binary_id), null: false
      add :submitted_vin, :string, null: false
      add :validation_status, :string, null: false, default: "pending" # pending, approved, rejected, expired
      add :photo_url, :string
      add :confidence_score, :float
      add :rejection_reason, :string
      add :expires_at, :utc_datetime, null: false
      add :validated_at, :utc_datetime
      add :metadata, :map, default: %{}

      timestamps()
    end

    create index(:vin_validations, [:vehicle_id])
    create index(:vin_validations, [:user_id])
    create index(:vin_validations, [:validation_status])
    create index(:vin_validations, [:expires_at])
    create index(:vin_validations, [:submitted_vin])
  end
end