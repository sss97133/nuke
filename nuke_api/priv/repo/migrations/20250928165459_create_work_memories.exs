defmodule NukeApi.Repo.Migrations.CreateWorkMemories do
  use Ecto.Migration

  def change do
    create table(:work_memories, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :vehicle_id, :binary_id, null: false

      # Freeform user input - the actual memory
      add :memory_text, :text, null: false
      add :work_category, :string
      add :confidence_level, :string, null: false, default: "pretty_sure"

      # Whatever partial data they remember
      add :brands_mentioned, {:array, :string}, default: []
      add :parts_mentioned, {:array, :string}, default: []
      add :people_involved, {:array, :string}, default: []
      add :tools_used, {:array, :string}, default: []
      add :locations, {:array, :string}, default: []

      # Rough estimates - whatever they remember
      add :time_period, :string
      add :approximate_cost, :decimal
      add :labor_split, :string

      # Quality/satisfaction notes
      add :quality_notes, :text
      add :issues_encountered, :text
      add :future_plans, :text

      # Link to evidence they remember exists
      add :has_photos, :boolean, default: false
      add :has_receipts, :boolean, default: false
      add :photo_descriptions, {:array, :string}, default: []

      # System will try to link this to actual data later
      add :linked_images, {:array, :binary_id}, default: []
      add :linked_timeline_events, {:array, :binary_id}, default: []
      add :verification_score, :integer

      timestamps()
    end

    create index(:work_memories, [:vehicle_id])
    create index(:work_memories, [:work_category])
    create index(:work_memories, [:confidence_level])
    create index(:work_memories, [:inserted_at])
  end
end
