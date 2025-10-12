defmodule NukeApi.Repo.Migrations.AddTimestampsToVehicleDocuments do
  use Ecto.Migration

  def change do
    alter table(:vehicle_documents) do
      add :inserted_at, :naive_datetime, null: false, default: fragment("NOW()")
      add :updated_at, :naive_datetime, null: false, default: fragment("NOW()")
    end
  end
end
