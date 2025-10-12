defmodule NukeApi.Pricing.ConditionAssessment do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  @derive {Jason.Encoder, except: [:__meta__, :vehicle, :image_tag]}

  @condition_types ["damage", "wear", "maintenance_needed"]
  @severities ["minor", "moderate", "major", "severe"]
  @urgencies ["immediate", "soon", "eventual", "cosmetic"]

  schema "condition_assessments" do
    field :condition_type, :string
    field :severity, :string
    field :location_on_vehicle, :string
    field :repair_cost_estimate, :decimal
    field :value_impact, :decimal
    field :urgency, :string
    field :visual_confirmation_score, :float, default: 0.0
    field :professional_assessment, :boolean, default: false

    belongs_to :vehicle, NukeApi.Vehicles.Vehicle
    belongs_to :image_tag, NukeApi.Vehicles.ImageTag

    timestamps(type: :utc_datetime)
  end

  def changeset(condition_assessment, attrs) do
    condition_assessment
    |> cast(attrs, [
      :vehicle_id, :image_tag_id, :condition_type, :severity,
      :location_on_vehicle, :repair_cost_estimate, :value_impact,
      :urgency, :visual_confirmation_score, :professional_assessment
    ])
    |> validate_required([:vehicle_id, :condition_type, :severity, :value_impact])
    |> validate_inclusion(:condition_type, @condition_types)
    |> validate_inclusion(:severity, @severities)
    |> validate_inclusion(:urgency, @urgencies)
    |> validate_number(:visual_confirmation_score, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> foreign_key_constraint(:vehicle_id)
    |> foreign_key_constraint(:image_tag_id)
  end

  def condition_types, do: @condition_types
  def severities, do: @severities
  def urgencies, do: @urgencies
end