defmodule NukeApi.Pricing.ModificationImpact do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  @derive {Jason.Encoder, except: [:__meta__, :vehicle, :image_tag]}

  @modification_types ["performance", "aesthetic", "functional"]
  @installation_qualities ["professional", "diy_good", "diy_poor"]
  @documentation_qualities ["excellent", "good", "fair", "poor"]
  @market_demands ["high", "medium", "low"]

  schema "modification_impacts" do
    field :modification_type, :string
    field :modification_name, :string
    field :brand, :string
    field :part_number, :string
    field :estimated_cost, :decimal
    field :current_value_impact, :decimal
    field :depreciation_rate, :float, default: 0.1
    field :installation_quality, :string
    field :visual_verification_score, :float, default: 0.0
    field :documentation_quality, :string
    field :market_demand, :string
    field :resale_factor, :float, default: 0.5

    belongs_to :vehicle, NukeApi.Vehicles.Vehicle
    belongs_to :image_tag, NukeApi.Vehicles.ImageTag

    timestamps(type: :utc_datetime)
  end

  def changeset(modification_impact, attrs) do
    modification_impact
    |> cast(attrs, [
      :vehicle_id, :image_tag_id, :modification_type, :modification_name,
      :brand, :part_number, :estimated_cost, :current_value_impact,
      :depreciation_rate, :installation_quality, :visual_verification_score,
      :documentation_quality, :market_demand, :resale_factor
    ])
    |> validate_required([:modification_type, :modification_name, :current_value_impact])
    |> validate_inclusion(:modification_type, @modification_types)
    |> validate_inclusion(:installation_quality, @installation_qualities)
    |> validate_inclusion(:documentation_quality, @documentation_qualities)
    |> validate_inclusion(:market_demand, @market_demands)
    |> validate_number(:depreciation_rate, greater_than_or_equal_to: 0, less_than_or_equal_to: 1)
    |> validate_number(:visual_verification_score, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_number(:resale_factor, greater_than_or_equal_to: 0, less_than_or_equal_to: 1)
    |> foreign_key_constraint(:vehicle_id)
    |> foreign_key_constraint(:image_tag_id)
  end

  def modification_types, do: @modification_types
  def installation_qualities, do: @installation_qualities
  def documentation_qualities, do: @documentation_qualities
  def market_demands, do: @market_demands
end