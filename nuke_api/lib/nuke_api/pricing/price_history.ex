defmodule NukeApi.Pricing.PriceHistory do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  @derive {Jason.Encoder, except: [:__meta__, :vehicle]}

  schema "price_history" do
    field :estimated_value, :decimal
    field :mileage_at_time, :integer
    field :valuation_date, :date
    field :value_change, :decimal, default: Decimal.new("0")
    field :percent_change, :float, default: 0.0
    field :change_reason, :string
    field :confidence_score, :float
    field :data_source, :string

    belongs_to :vehicle, NukeApi.Vehicles.Vehicle

    timestamps(type: :utc_datetime)
  end

  def changeset(price_history, attrs) do
    price_history
    |> cast(attrs, [
      :vehicle_id, :estimated_value, :mileage_at_time, :valuation_date,
      :value_change, :percent_change, :change_reason, :confidence_score, :data_source
    ])
    |> validate_required([:vehicle_id, :estimated_value, :valuation_date])
    |> validate_number(:percent_change, greater_than_or_equal_to: -100.0)
    |> validate_number(:confidence_score, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> foreign_key_constraint(:vehicle_id)
  end
end