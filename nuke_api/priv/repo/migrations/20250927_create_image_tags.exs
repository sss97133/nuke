defmodule NukeApi.Repo.Migrations.CreateImageTags do
  use Ecto.Migration

  def change do
    create table(:image_tags, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :image_id, references(:vehicle_images, type: :binary_id, on_delete: :delete_all), null: false
      add :x_position, :float, null: false
      add :y_position, :float, null: false
      add :tag_type, :string, null: false
      add :text, :text, null: false
      add :verification_status, :string, default: "pending"
      add :trust_score, :integer, default: 10
      add :created_by, :string
      add :verified_by, :string
      add :verified_at, :utc_datetime
      add :metadata, :map, default: %{}

      timestamps(type: :utc_datetime)
    end

    create index(:image_tags, [:image_id])
    create index(:image_tags, [:tag_type])
    create index(:image_tags, [:verification_status])
    create index(:image_tags, [:trust_score])
    create index(:image_tags, [:inserted_at])
  end
end