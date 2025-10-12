defmodule NukeApi.Pricing.PriceEstimate do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  @derive {Jason.Encoder, except: [:__meta__, :vehicle, :value_components]}

  schema "price_estimates" do
    field :total_estimated_value, :decimal
    field :confidence_score, :float
    field :base_market_value, :decimal
    field :modification_impact, :decimal, default: Decimal.new("0")
    field :condition_adjustment, :decimal, default: Decimal.new("0")
    field :market_factors, :decimal, default: Decimal.new("0")
    field :rarity_multiplier, :float, default: 1.0
    field :visual_evidence, :map, default: %{}
    field :market_comparables, :map, default: %{}
    field :value_drivers, :map, default: %{}
    field :risk_factors, :map, default: %{}
    field :estimation_method, :string, default: "comprehensive"
    field :data_sources_used, {:array, :string}, default: []
    field :estimated_by, :string
    field :notes, :string

    belongs_to :vehicle, NukeApi.Vehicles.Vehicle
    has_many :value_components, NukeApi.Pricing.ValueComponent

    timestamps(type: :utc_datetime)
  end

  def changeset(price_estimate, attrs) do
    price_estimate
    |> cast(attrs, [
      :vehicle_id, :total_estimated_value, :confidence_score, :base_market_value,
      :modification_impact, :condition_adjustment, :market_factors, :rarity_multiplier,
      :visual_evidence, :market_comparables, :value_drivers, :risk_factors,
      :estimation_method, :data_sources_used, :estimated_by, :notes
    ])
    |> validate_required([:vehicle_id, :total_estimated_value, :confidence_score, :base_market_value])
    |> validate_number(:confidence_score, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_number(:rarity_multiplier, greater_than: 0)
    |> foreign_key_constraint(:vehicle_id)
  end
end