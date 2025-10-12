defmodule NukeApi.Finance.Transaction do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "vehicle_financial_transactions" do
    field :transaction_type, :string
    field :category, :string
    field :subcategory, :string
    field :description, :string
    field :transaction_date, :date

    # Financial Details
    field :amount, :decimal
    field :currency, :string, default: "USD"
    field :payment_method, :string

    # Vendor Information
    field :vendor_name, :string
    field :vendor_location, :string
    field :vendor_contact, :string

    # Documentation
    field :receipt_url, :string
    field :invoice_number, :string
    field :reference_number, :string

    # Tax Information
    field :tax_deductible, :boolean, default: false
    field :business_expense, :boolean, default: false
    field :tax_category, :string

    # Parts/Labor Breakdown
    field :parts_cost, :decimal
    field :labor_cost, :decimal
    field :labor_hours, :decimal
    field :shop_rate_per_hour, :decimal

    # Vehicle State
    field :mileage_at_transaction, :integer
    field :vehicle_condition_before, :string
    field :vehicle_condition_after, :string

    # Metadata
    field :metadata, :map, default: %{}
    field :notes, :string

    # User Tracking
    field :recorded_by, :binary_id

    belongs_to :vehicle, NukeApi.Vehicles.Vehicle
    belongs_to :timeline_event, NukeApi.Vehicles.Timeline

    timestamps()
  end

  @transaction_types [
    "purchase", "sale", "improvement", "maintenance", "repair",
    "registration", "insurance", "inspection", "storage", "transport",
    "tools", "documentation", "professional_services", "sale_expense"
  ]

  @expense_categories [
    # Mechanical
    "engine", "transmission", "drivetrain", "suspension", "brakes",
    "steering", "electrical", "cooling", "fuel_system", "exhaust",

    # Body & Interior
    "body_work", "paint", "interior", "glass", "trim", "wheels_tires",

    # Maintenance
    "oil_change", "tune_up", "fluid_service", "filters", "belts_hoses",

    # Administrative
    "registration", "title", "insurance", "inspection", "storage",
    "transportation", "documentation", "legal", "professional_services",

    # Tools & Equipment
    "tools", "equipment", "shop_supplies",

    # Other
    "miscellaneous"
  ]

  @payment_methods [
    "cash", "check", "debit_card", "credit_card", "financing",
    "trade", "barter", "other"
  ]

  @doc false
  def changeset(transaction, attrs) do
    transaction
    |> cast(attrs, [
      :vehicle_id, :transaction_type, :category, :subcategory, :description,
      :transaction_date, :amount, :currency, :payment_method, :vendor_name,
      :vendor_location, :vendor_contact, :receipt_url, :invoice_number,
      :reference_number, :tax_deductible, :business_expense, :tax_category,
      :parts_cost, :labor_cost, :labor_hours, :shop_rate_per_hour,
      :mileage_at_transaction, :vehicle_condition_before, :vehicle_condition_after,
      :metadata, :notes, :recorded_by, :timeline_event_id
    ])
    |> validate_required([:vehicle_id, :transaction_type, :category, :description,
                         :transaction_date, :amount, :recorded_by])
    |> validate_inclusion(:transaction_type, @transaction_types)
    |> validate_inclusion(:category, @expense_categories)
    |> validate_inclusion(:payment_method, @payment_methods)
    |> validate_number(:amount, greater_than: 0)
    |> validate_number(:parts_cost, greater_than_or_equal_to: 0)
    |> validate_number(:labor_cost, greater_than_or_equal_to: 0)
    |> validate_number(:labor_hours, greater_than_or_equal_to: 0)
    |> validate_number(:shop_rate_per_hour, greater_than_or_equal_to: 0)
    |> foreign_key_constraint(:vehicle_id)
    |> foreign_key_constraint(:timeline_event_id)
  end

  @doc """
  Returns list of available transaction types.
  """
  def transaction_types, do: @transaction_types

  @doc """
  Returns list of available expense categories.
  """
  def expense_categories, do: @expense_categories

  @doc """
  Returns list of available payment methods.
  """
  def payment_methods, do: @payment_methods
end