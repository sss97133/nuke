defmodule NukeApi.Pricing.ValueComponent do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  @derive {Jason.Encoder, except: [:__meta__, :price_estimate]}

  @component_types ["base", "modification", "condition", "rarity", "market"]
  @verification_statuses ["unverified", "verified", "disputed"]

  schema "value_components" do
    field :component_type, :string
    field :component_name, :string
    field :category, :string
    field :value_contribution, :decimal
    field :confidence_score, :float
    field :weight_factor, :float, default: 1.0
    field :evidence_count, :integer, default: 0
    field :verification_status, :string, default: "unverified"
    field :source_references, {:array, :string}, default: []

    belongs_to :price_estimate, NukeApi.Pricing.PriceEstimate

    timestamps(type: :utc_datetime)
  end

  def changeset(value_component, attrs) do
    value_component
    |> cast(attrs, [
      :price_estimate_id, :component_type, :component_name, :category,
      :value_contribution, :confidence_score, :weight_factor,
      :evidence_count, :verification_status, :source_references
    ])
    |> validate_required([:price_estimate_id, :component_type, :component_name, :value_contribution, :confidence_score])
    |> validate_inclusion(:component_type, @component_types)
    |> validate_inclusion(:verification_status, @verification_statuses)
    |> validate_number(:confidence_score, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_number(:weight_factor, greater_than: 0)
    |> validate_number(:evidence_count, greater_than_or_equal_to: 0)
    |> foreign_key_constraint(:price_estimate_id)
  end

  def component_types, do: @component_types
  def verification_statuses, do: @verification_statuses
end