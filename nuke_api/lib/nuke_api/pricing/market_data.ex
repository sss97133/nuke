defmodule NukeApi.Pricing.MarketData do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  @derive {Jason.Encoder, except: [:__meta__, :vehicle]}

  @data_types ["listing", "valuation", "historical_sale"]
  @locations ["national", "regional", "local"]

  schema "market_data" do
    field :source, :string
    field :source_url, :string
    field :data_type, :string
    field :price_value, :decimal
    field :price_range_low, :decimal
    field :price_range_high, :decimal
    field :mileage_at_time, :integer
    field :condition_rating, :string
    field :location, :string
    field :listing_date, :date
    field :sale_date, :date
    field :days_on_market, :integer
    field :raw_data, :map, default: %{}
    field :confidence_score, :float
    field :last_verified, :utc_datetime

    belongs_to :vehicle, NukeApi.Vehicles.Vehicle

    timestamps(type: :utc_datetime)
  end

  def changeset(market_data, attrs) do
    market_data
    |> cast(attrs, [
      :vehicle_id, :source, :source_url, :data_type, :price_value,
      :price_range_low, :price_range_high, :mileage_at_time, :condition_rating,
      :location, :listing_date, :sale_date, :days_on_market, :raw_data,
      :confidence_score, :last_verified
    ])
    |> validate_required([:source, :data_type])
    |> validate_inclusion(:data_type, @data_types)
    |> validate_inclusion(:location, @locations)
    |> validate_number(:confidence_score, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_number(:days_on_market, greater_than_or_equal_to: 0)
    |> foreign_key_constraint(:vehicle_id)
  end

  def data_types, do: @data_types
  def locations, do: @locations
end