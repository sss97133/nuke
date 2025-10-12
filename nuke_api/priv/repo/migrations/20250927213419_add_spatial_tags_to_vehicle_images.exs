defmodule NukeApi.Repo.Migrations.AddSpatialTagsToVehicleImages do
  use Ecto.Migration

  def change do
    alter table(:vehicle_images) do
      add :spatial_tags, {:array, :map}, default: []
    end
  end
end
