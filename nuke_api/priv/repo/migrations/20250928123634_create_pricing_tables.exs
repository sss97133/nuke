defmodule NukeApi.Repo.Migrations.CreatePricingTables do
  use Ecto.Migration

  def change do
    # Price estimates - the main pricing intelligence results
    create table(:price_estimates, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :vehicle_id, references(:vehicles, on_delete: :delete_all, type: :binary_id), null: false

      # Core valuation data
      add :total_estimated_value, :decimal, precision: 12, scale: 2, null: false
      add :confidence_score, :float, null: false

      # Price breakdown components
      add :base_market_value, :decimal, precision: 12, scale: 2, null: false
      add :modification_impact, :decimal, precision: 12, scale: 2, default: 0
      add :condition_adjustment, :decimal, precision: 12, scale: 2, default: 0
      add :market_factors, :decimal, precision: 12, scale: 2, default: 0
      add :rarity_multiplier, :float, default: 1.0

      # Supporting data (JSON fields for flexibility)
      add :visual_evidence, :map, default: %{}
      add :market_comparables, :map, default: %{}
      add :value_drivers, :map, default: %{}
      add :risk_factors, :map, default: %{}

      # Metadata
      add :estimation_method, :string, default: "comprehensive"
      add :data_sources_used, {:array, :string}, default: []
      add :estimated_by, :string # User or system identifier
      add :notes, :text

      timestamps(type: :utc_datetime)
    end

    # Market data - external price sources
    create table(:market_data, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :vehicle_id, references(:vehicles, on_delete: :delete_all, type: :binary_id)

      # Market source identification
      add :source, :string, null: false # "kbb", "edmunds", "cargurus", etc.
      add :source_url, :text
      add :data_type, :string, null: false # "listing", "valuation", "historical_sale"

      # Price data
      add :price_value, :decimal, precision: 12, scale: 2
      add :price_range_low, :decimal, precision: 12, scale: 2
      add :price_range_high, :decimal, precision: 12, scale: 2
      add :mileage_at_time, :integer
      add :condition_rating, :string

      # Market context
      add :location, :string # "national", "regional", "local"
      add :listing_date, :date
      add :sale_date, :date
      add :days_on_market, :integer

      # Raw data and metadata
      add :raw_data, :map, default: %{}
      add :confidence_score, :float
      add :last_verified, :utc_datetime

      timestamps(type: :utc_datetime)
    end

    # Modification impacts - how modifications affect value
    create table(:modification_impacts, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :vehicle_id, references(:vehicles, on_delete: :delete_all, type: :binary_id)
      add :image_tag_id, references(:image_tags, on_delete: :delete_all, type: :binary_id)

      # Modification details
      add :modification_type, :string, null: false # "performance", "aesthetic", "functional"
      add :modification_name, :string, null: false
      add :brand, :string
      add :part_number, :string

      # Value impact
      add :estimated_cost, :decimal, precision: 10, scale: 2
      add :current_value_impact, :decimal, precision: 10, scale: 2, null: false
      add :depreciation_rate, :float, default: 0.1 # Annual depreciation

      # Quality and verification
      add :installation_quality, :string # "professional", "diy_good", "diy_poor"
      add :visual_verification_score, :float, default: 0
      add :documentation_quality, :string # "excellent", "good", "fair", "poor"

      # Market data
      add :market_demand, :string # "high", "medium", "low"
      add :resale_factor, :float, default: 0.5 # % of cost recoverable

      timestamps(type: :utc_datetime)
    end

    # Condition assessments - how damage/wear affects value
    create table(:condition_assessments, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :vehicle_id, references(:vehicles, on_delete: :delete_all, type: :binary_id), null: false
      add :image_tag_id, references(:image_tags, on_delete: :delete_all, type: :binary_id)

      # Damage/condition details
      add :condition_type, :string, null: false # "damage", "wear", "maintenance_needed"
      add :severity, :string, null: false # "minor", "moderate", "major", "severe"
      add :location_on_vehicle, :string # "front_bumper", "driver_door", etc.

      # Financial impact
      add :repair_cost_estimate, :decimal, precision: 10, scale: 2
      add :value_impact, :decimal, precision: 10, scale: 2, null: false
      add :urgency, :string # "immediate", "soon", "eventual", "cosmetic"

      # Visual evidence
      add :visual_confirmation_score, :float, default: 0
      add :professional_assessment, :boolean, default: false

      timestamps(type: :utc_datetime)
    end

    # Value components - granular breakdown of what drives value
    create table(:value_components, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :price_estimate_id, references(:price_estimates, on_delete: :delete_all, type: :binary_id), null: false

      # Component identification
      add :component_type, :string, null: false # "base", "modification", "condition", "rarity", "market"
      add :component_name, :string, null: false
      add :category, :string # Grouping for UI display

      # Value data
      add :value_contribution, :decimal, precision: 10, scale: 2, null: false
      add :confidence_score, :float, null: false
      add :weight_factor, :float, default: 1.0

      # Supporting evidence
      add :evidence_count, :integer, default: 0
      add :verification_status, :string, default: "unverified"
      add :source_references, {:array, :string}, default: []

      timestamps(type: :utc_datetime)
    end

    # User price inputs - when users provide their own pricing data
    create table(:user_price_inputs, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :vehicle_id, references(:vehicles, on_delete: :delete_all, type: :binary_id), null: false
      add :user_id, :string, null: false

      # Price information
      add :input_type, :string, null: false # "asking_price", "paid_price", "estimated_value", "insurance_appraisal"
      add :price_value, :decimal, precision: 12, scale: 2, null: false
      add :currency, :string, default: "USD"

      # Context
      add :price_date, :date, null: false
      add :mileage_at_time, :integer
      add :location, :string
      add :transaction_type, :string # "sale", "purchase", "appraisal", "estimate"

      # Verification
      add :verification_documents, {:array, :string}, default: []
      add :verification_status, :string, default: "user_reported"
      add :notes, :text

      timestamps(type: :utc_datetime)
    end

    # Price history - track value changes over time
    create table(:price_history, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :vehicle_id, references(:vehicles, on_delete: :delete_all, type: :binary_id), null: false

      # Price tracking
      add :estimated_value, :decimal, precision: 12, scale: 2, null: false
      add :mileage_at_time, :integer
      add :valuation_date, :date, null: false

      # Change tracking
      add :value_change, :decimal, precision: 10, scale: 2, default: 0
      add :percent_change, :float, default: 0
      add :change_reason, :string # "mileage", "market_conditions", "modifications", "damage"

      # Data quality
      add :confidence_score, :float
      add :data_source, :string # "system", "user_input", "market_data"

      timestamps(type: :utc_datetime)
    end

    # Add indexes for performance
    create index(:price_estimates, [:vehicle_id])
    create index(:price_estimates, [:total_estimated_value])
    create index(:price_estimates, [:confidence_score])

    create index(:market_data, [:vehicle_id])
    create index(:market_data, [:source])
    create index(:market_data, [:data_type])
    create index(:market_data, [:listing_date])

    create index(:modification_impacts, [:vehicle_id])
    create index(:modification_impacts, [:image_tag_id])
    create index(:modification_impacts, [:modification_type])

    create index(:condition_assessments, [:vehicle_id])
    create index(:condition_assessments, [:image_tag_id])
    create index(:condition_assessments, [:condition_type])
    create index(:condition_assessments, [:severity])

    create index(:value_components, [:price_estimate_id])
    create index(:value_components, [:component_type])

    create index(:user_price_inputs, [:vehicle_id])
    create index(:user_price_inputs, [:user_id])
    create index(:user_price_inputs, [:input_type])
    create index(:user_price_inputs, [:price_date])

    create index(:price_history, [:vehicle_id])
    create index(:price_history, [:valuation_date])
    create index(:price_history, [:estimated_value])

    # Add unique constraints where appropriate
    create unique_index(:market_data, [:vehicle_id, :source, :data_type, :listing_date])
    create unique_index(:modification_impacts, [:vehicle_id, :image_tag_id])
    create unique_index(:condition_assessments, [:vehicle_id, :image_tag_id])
  end
end