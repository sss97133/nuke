defmodule NukeApi.Repo.Migrations.AddVinUniquenessConstraint do
  use Ecto.Migration

  def change do
    create unique_index(:vehicles, [:vin], name: :vehicles_vin_unique_index, where: "vin IS NOT NULL")
  end
end
