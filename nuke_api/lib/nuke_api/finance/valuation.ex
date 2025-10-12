defmodule NukeApi.Finance.Valuation do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "vehicle_valuations" do
    field :valuation_date, :date
    field :valuation_type, :string
    field :estimated_value, :decimal
    field :condition_rating, :string

    field :appraiser_name, :string
    field :appraiser_credentials, :string
    field :appraisal_purpose, :string

    field :market_factors, :string
    field :condition_notes, :string
    field :comparable_sales, :map

    field :documentation_url, :string
    field :recorded_by, :binary_id

    belongs_to :vehicle, NukeApi.Vehicles.Vehicle

    timestamps()
  end

  @valuation_types [
    "appraisal", "insurance_estimate", "market_estimate", "auction_estimate",
    "dealer_quote", "private_party_estimate", "trade_in_estimate", "loan_valuation"
  ]

  @condition_ratings [
    "excellent", "very_good", "good", "fair", "poor", "salvage"
  ]

  @appraisal_purposes [
    "insurance", "sale", "loan", "tax", "divorce", "estate", "donation", "legal"
  ]

  @doc false
  def changeset(valuation, attrs) do
    valuation
    |> cast(attrs, [
      :vehicle_id, :valuation_date, :valuation_type, :estimated_value,
      :condition_rating, :appraiser_name, :appraiser_credentials,
      :appraisal_purpose, :market_factors, :condition_notes,
      :comparable_sales, :documentation_url, :recorded_by
    ])
    |> validate_required([:vehicle_id, :valuation_date, :valuation_type, :estimated_value, :recorded_by])
    |> validate_inclusion(:valuation_type, @valuation_types)
    |> validate_inclusion(:condition_rating, @condition_ratings)
    |> validate_inclusion(:appraisal_purpose, @appraisal_purposes)
    |> validate_number(:estimated_value, greater_than: 0)
    |> foreign_key_constraint(:vehicle_id)
  end

  @doc """
  Returns list of available valuation types.
  """
  def valuation_types, do: @valuation_types

  @doc """
  Returns list of available condition ratings.
  """
  def condition_ratings, do: @condition_ratings

  @doc """
  Returns list of available appraisal purposes.
  """
  def appraisal_purposes, do: @appraisal_purposes
end