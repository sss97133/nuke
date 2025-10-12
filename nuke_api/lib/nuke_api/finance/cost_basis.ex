defmodule NukeApi.Finance.CostBasis do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "vehicle_cost_basis" do
    field :purchase_price, :decimal
    field :purchase_date, :date
    field :purchase_location, :string
    field :seller_info, :string

    # Additional Acquisition Costs
    field :title_fees, :decimal, default: 0
    field :registration_fees, :decimal, default: 0
    field :inspection_fees, :decimal, default: 0
    field :transportation_costs, :decimal, default: 0
    field :auction_fees, :decimal, default: 0
    field :other_acquisition_costs, :decimal, default: 0

    # Running Totals (calculated)
    field :total_improvements, :decimal, default: 0
    field :total_maintenance, :decimal, default: 0
    field :total_basis, :decimal, default: 0

    # Sale Information
    field :sale_price, :decimal
    field :sale_date, :date
    field :sale_expenses, :decimal, default: 0
    field :commission_rate, :decimal
    field :commission_amount, :decimal

    # Tax Implications
    field :depreciation_method, :string
    field :depreciation_years, :integer
    field :annual_depreciation, :decimal
    field :accumulated_depreciation, :decimal, default: 0

    # Capital Gains/Losses
    field :capital_gain_loss, :decimal
    field :holding_period_days, :integer
    field :is_long_term_gain, :boolean

    # Business vs Personal Use
    field :business_use_percentage, :decimal, default: 0
    field :personal_use_percentage, :decimal, default: 100

    field :recorded_by, :binary_id

    belongs_to :vehicle, NukeApi.Vehicles.Vehicle

    timestamps()
  end

  @depreciation_methods [
    "straight_line", "declining_balance", "sum_of_years", "units_of_production"
  ]

  @doc false
  def changeset(cost_basis, attrs) do
    cost_basis
    |> cast(attrs, [
      :vehicle_id, :purchase_price, :purchase_date, :purchase_location, :seller_info,
      :title_fees, :registration_fees, :inspection_fees, :transportation_costs,
      :auction_fees, :other_acquisition_costs, :total_improvements, :total_maintenance,
      :total_basis, :sale_price, :sale_date, :sale_expenses, :commission_rate,
      :commission_amount, :depreciation_method, :depreciation_years, :annual_depreciation,
      :accumulated_depreciation, :capital_gain_loss, :holding_period_days,
      :is_long_term_gain, :business_use_percentage, :personal_use_percentage, :recorded_by
    ])
    |> validate_required([:vehicle_id, :purchase_price, :purchase_date, :recorded_by])
    |> validate_inclusion(:depreciation_method, @depreciation_methods)
    |> validate_number(:purchase_price, greater_than: 0)
    |> validate_number(:business_use_percentage, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_number(:personal_use_percentage, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_percentage_sum()
    |> unique_constraint(:vehicle_id)
    |> foreign_key_constraint(:vehicle_id)
  end

  defp validate_percentage_sum(changeset) do
    business = get_field(changeset, :business_use_percentage) || Decimal.new(0)
    personal = get_field(changeset, :personal_use_percentage) || Decimal.new(100)

    total = Decimal.add(business, personal)

    if Decimal.equal?(total, 100) do
      changeset
    else
      add_error(changeset, :business_use_percentage, "Business and personal use percentages must sum to 100")
    end
  end

  @doc """
  Returns list of available depreciation methods.
  """
  def depreciation_methods, do: @depreciation_methods
end