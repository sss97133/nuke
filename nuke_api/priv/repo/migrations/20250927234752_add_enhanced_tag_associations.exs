defmodule NukeApi.Repo.Migrations.AddEnhancedTagAssociations do
  use Ecto.Migration

  def change do
    # Create products table for linking damage/modification tags to products
    create table(:products, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :name, :string, null: false
      add :category, :string, null: false # "part", "fluid", "tool", "material", "accessory"
      add :brand, :string
      add :model, :string
      add :part_number, :string
      add :description, :text
      add :price_cents, :integer
      add :currency, :string, default: "USD"
      add :availability, :string, default: "available" # available, discontinued, back_ordered
      add :specifications, :map, default: %{} # JSONB for flexible specs
      add :tags, {:array, :string}, default: [] # searchable tags

      timestamps(type: :utc_datetime)
    end

    # Create shops table for location/business tracking
    create table(:shops, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :name, :string, null: false
      add :business_type, :string, null: false # "dealership", "independent", "chain", "mobile", "diy_garage"
      add :license_number, :string
      add :certifications, {:array, :string}, default: []
      add :services_offered, {:array, :string}, default: []
      add :contact_info, :map, default: %{}
      add :address, :map, default: %{}
      add :business_hours, :map, default: %{}
      add :specializes_in, {:array, :string}, default: [] # vehicle types, brands, services
      add :equipment_available, {:array, :string}, default: []
      add :active, :boolean, default: true

      timestamps(type: :utc_datetime)
    end

    # Create technicians table for professional service tracking
    create table(:technicians, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :name, :string, null: false
      add :license_number, :string
      add :certification_level, :string # "apprentice", "journeyman", "master", "ase_certified"
      add :specializations, {:array, :string}, default: [] # ["electrical", "engine", "transmission", etc.]
      add :shop_id, references(:shops, type: :binary_id)
      add :hourly_rate_cents, :integer
      add :experience_years, :integer
      add :contact_info, :map, default: %{}
      add :active, :boolean, default: true

      timestamps(type: :utc_datetime)
    end

    # Create services table for modification/repair service tracking
    create table(:services, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :name, :string, null: false
      add :category, :string, null: false # "repair", "modification", "maintenance", "diagnostic", "installation"
      add :subcategory, :string # "engine_repair", "suspension_mod", "oil_change", etc.
      add :description, :text
      add :estimated_duration_minutes, :integer
      add :skill_level_required, :string # "basic", "intermediate", "advanced", "professional"
      add :tools_required, {:array, :string}, default: []
      add :typical_cost_range, :map, default: %{} # {"min_cents": 0, "max_cents": 0, "currency": "USD"}
      add :warranty_period_days, :integer

      timestamps(type: :utc_datetime)
    end

    # Enhance image_tags table with new associations and automated tagging
    alter table(:image_tags) do
      # Product associations for damage/modification tags
      add :product_id, references(:products, type: :binary_id)
      add :product_relation, :string # "damaged", "replaced_with", "upgraded_to", "requires"

      # Service associations for repair/modification work
      add :service_id, references(:services, type: :binary_id)
      add :service_status, :string # "needed", "in_progress", "completed", "failed"

      # Professional service tracking
      add :technician_id, references(:technicians, type: :binary_id)
      add :shop_id, references(:shops, type: :binary_id)
      add :service_date, :utc_datetime
      add :service_cost_cents, :integer
      add :service_warranty_expires, :utc_datetime

      # EXIF and automated tagging
      add :source_type, :string, default: "manual" # "manual", "exif", "ai_detected", "imported"
      add :exif_data, :map, default: %{} # Store relevant EXIF metadata
      add :gps_coordinates, :map, default: %{} # {"lat": 0.0, "lng": 0.0, "accuracy": 0}
      add :automated_confidence, :float # 0.0 to 1.0 for AI/automated tags
      add :needs_human_verification, :boolean, default: false

      # Enhanced metadata
      add :condition_before, :string # For damage tags: condition before damage
      add :condition_after, :string # For repair tags: condition after repair
      add :severity_level, :string # "minor", "moderate", "severe", "critical"
      add :estimated_cost_cents, :integer # Estimated cost for repair/replacement
      add :insurance_claim_number, :string
      add :work_order_number, :string

      # Time tracking for modifications/repairs
      add :work_started_at, :utc_datetime
      add :work_completed_at, :utc_datetime
      add :estimated_completion, :utc_datetime
    end

    # Create indexes for performance
    create index(:products, [:category])
    create index(:products, [:brand])
    create index(:products, [:part_number])
    create index(:products, [:tags], using: :gin)

    create index(:technicians, [:shop_id])
    create index(:technicians, [:certification_level])
    create index(:technicians, [:specializations], using: :gin)
    create index(:technicians, [:active])

    create index(:shops, [:business_type])
    create index(:shops, [:active])
    create index(:shops, [:services_offered], using: :gin)

    create index(:services, [:category])
    create index(:services, [:subcategory])
    create index(:services, [:skill_level_required])

    create index(:image_tags, [:product_id])
    create index(:image_tags, [:service_id])
    create index(:image_tags, [:technician_id])
    create index(:image_tags, [:shop_id])
    create index(:image_tags, [:source_type])
    create index(:image_tags, [:service_date])
    create index(:image_tags, [:automated_confidence])
    create index(:image_tags, [:needs_human_verification])
    create index(:image_tags, [:severity_level])

    # Composite indexes for common queries
    create index(:image_tags, [:tag_type, :source_type])
    create index(:image_tags, [:tag_type, :severity_level])
    create index(:image_tags, [:service_status, :service_date])
    create index(:image_tags, [:shop_id, :technician_id, :service_date])
  end
end