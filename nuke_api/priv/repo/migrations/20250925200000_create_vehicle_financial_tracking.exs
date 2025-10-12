defmodule NukeApi.Repo.Migrations.CreateVehicleFinancialTracking do
  use Ecto.Migration

  def change do
    # Main financial transactions table
    create table(:vehicle_financial_transactions, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :vehicle_id, references(:vehicles, on_delete: :delete_all, type: :binary_id), null: false

      # Transaction Details
      add :transaction_type, :string, null: false # purchase, sale, expense, improvement, maintenance, etc.
      add :category, :string, null: false # engine, body, interior, suspension, tools, fees, etc.
      add :subcategory, :string # more specific categorization

      add :description, :text, null: false
      add :transaction_date, :date, null: false

      # Financial Details
      add :amount, :decimal, precision: 15, scale: 2, null: false
      add :currency, :string, default: "USD", null: false
      add :payment_method, :string # cash, check, card, financing, etc.

      # Vendor/Source Information
      add :vendor_name, :string
      add :vendor_location, :string
      add :vendor_contact, :string

      # Documentation
      add :receipt_url, :string
      add :invoice_number, :string
      add :reference_number, :string

      # Tax Information
      add :tax_deductible, :boolean, default: false
      add :business_expense, :boolean, default: false
      add :tax_category, :string

      # Parts/Labor Breakdown
      add :parts_cost, :decimal, precision: 15, scale: 2
      add :labor_cost, :decimal, precision: 15, scale: 2
      add :labor_hours, :decimal, precision: 8, scale: 2
      add :shop_rate_per_hour, :decimal, precision: 8, scale: 2

      # Vehicle Condition/Mileage at Time
      add :mileage_at_transaction, :integer
      add :vehicle_condition_before, :text
      add :vehicle_condition_after, :text

      # Timeline Integration
      add :timeline_event_id, references(:vehicle_timeline, type: :binary_id, on_delete: :nilify_all)

      # Metadata
      add :metadata, :map, default: %{}
      add :notes, :text

      # User Tracking
      add :recorded_by, :binary_id, null: false

      timestamps()
    end

    # Cost basis tracking - tracks the adjusted basis of the vehicle
    create table(:vehicle_cost_basis, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :vehicle_id, references(:vehicles, on_delete: :delete_all, type: :binary_id), null: false

      # Purchase Information
      add :purchase_price, :decimal, precision: 15, scale: 2, null: false
      add :purchase_date, :date, null: false
      add :purchase_location, :string
      add :seller_info, :text

      # Additional Acquisition Costs
      add :title_fees, :decimal, precision: 15, scale: 2, default: 0
      add :registration_fees, :decimal, precision: 15, scale: 2, default: 0
      add :inspection_fees, :decimal, precision: 15, scale: 2, default: 0
      add :transportation_costs, :decimal, precision: 15, scale: 2, default: 0
      add :auction_fees, :decimal, precision: 15, scale: 2, default: 0
      add :other_acquisition_costs, :decimal, precision: 15, scale: 2, default: 0

      # Running Totals (calculated fields)
      add :total_improvements, :decimal, precision: 15, scale: 2, default: 0
      add :total_maintenance, :decimal, precision: 15, scale: 2, default: 0
      add :total_basis, :decimal, precision: 15, scale: 2, default: 0

      # Sale Information (when applicable)
      add :sale_price, :decimal, precision: 15, scale: 2
      add :sale_date, :date
      add :sale_expenses, :decimal, precision: 15, scale: 2, default: 0
      add :commission_rate, :decimal, precision: 8, scale: 4
      add :commission_amount, :decimal, precision: 15, scale: 2

      # Tax Implications
      add :depreciation_method, :string # straight_line, declining_balance, etc.
      add :depreciation_years, :integer
      add :annual_depreciation, :decimal, precision: 15, scale: 2
      add :accumulated_depreciation, :decimal, precision: 15, scale: 2, default: 0

      # Capital Gains/Losses
      add :capital_gain_loss, :decimal, precision: 15, scale: 2
      add :holding_period_days, :integer
      add :is_long_term_gain, :boolean

      # Business vs Personal Use
      add :business_use_percentage, :decimal, precision: 5, scale: 2, default: 0
      add :personal_use_percentage, :decimal, precision: 5, scale: 2, default: 100

      add :recorded_by, :binary_id, null: false
      timestamps()
    end

    # Periodic valuations and appraisals
    create table(:vehicle_valuations, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :vehicle_id, references(:vehicles, on_delete: :delete_all, type: :binary_id), null: false

      add :valuation_date, :date, null: false
      add :valuation_type, :string, null: false # appraisal, insurance, market_estimate, etc.
      add :estimated_value, :decimal, precision: 15, scale: 2, null: false
      add :condition_rating, :string # excellent, good, fair, poor, etc.

      add :appraiser_name, :string
      add :appraiser_credentials, :string
      add :appraisal_purpose, :string # insurance, sale, loan, tax, etc.

      add :market_factors, :text
      add :condition_notes, :text
      add :comparable_sales, :jsonb

      add :documentation_url, :string
      add :recorded_by, :binary_id, null: false

      timestamps()
    end

    # Indexes for performance
    create index(:vehicle_financial_transactions, [:vehicle_id])
    create index(:vehicle_financial_transactions, [:transaction_type])
    create index(:vehicle_financial_transactions, [:category])
    create index(:vehicle_financial_transactions, [:transaction_date])
    create index(:vehicle_financial_transactions, [:recorded_by])
    create index(:vehicle_financial_transactions, [:business_expense])

    create unique_index(:vehicle_cost_basis, [:vehicle_id])

    create index(:vehicle_valuations, [:vehicle_id])
    create index(:vehicle_valuations, [:valuation_date])
    create index(:vehicle_valuations, [:valuation_type])
  end
end