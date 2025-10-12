defmodule NukeApi.Repo.Migrations.CreateWorkLocations do
  use Ecto.Migration

  def change do
    # Work locations table - foundational location contexts
    create table(:work_locations, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :user_id, references(:users, type: :binary_id), null: false

      # Core location classification
      add :location_type, :string, null: false # "home", "shop", "mobile", "outdoor"
      add :work_context, :string, null: false # "personal", "professional", "commercial", "hobbyist"
      add :primary_use, :string, null: false # "restoration", "maintenance", "repair", "fabrication"

      # Physical characteristics
      add :space_size, :string # "single_bay", "double_bay", "multi_bay", "driveway", "yard"
      add :surface_type, :string # "concrete", "asphalt", "gravel", "dirt", "epoxy_coated"
      add :covered, :boolean, default: false
      add :climate_controlled, :boolean, default: false

      # Equipment and infrastructure
      add :has_lift, :boolean, default: false
      add :has_compressor, :boolean, default: false
      add :has_welding, :boolean, default: false
      add :has_specialty_tools, :boolean, default: false
      add :power_available, :string # "basic_110", "220_available", "industrial_power"

      # Professional indicators
      add :business_license, :boolean, default: false
      add :insurance_type, :string # "none", "personal", "commercial", "professional"
      add :certification_level, :string # "none", "ase", "manufacturer", "specialty"

      # Pattern detection fields
      add :tool_quality_score, :integer, default: 0 # 1-100 based on detected tool brands
      add :organization_score, :integer, default: 0 # 1-100 based on workspace organization
      add :frequency_score, :integer, default: 0 # 1-100 based on usage patterns

      # Location metadata
      add :name, :string
      add :description, :text
      add :address, :text
      add :latitude, :decimal, precision: 10, scale: 6
      add :longitude, :decimal, precision: 10, scale: 6
      add :timezone, :string

      # Pattern analysis
      add :detected_patterns, :map, default: %{} # JSONB for ML pattern storage
      add :confidence_score, :integer, default: 0 # Overall confidence in classification

      timestamps(type: :utc_datetime)
    end

    # Location sessions - track individual work sessions
    create table(:location_sessions, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :work_location_id, references(:work_locations, type: :binary_id, on_delete: :delete_all), null: false
      add :user_id, references(:users, type: :binary_id), null: false
      add :vehicle_id, references(:vehicles, type: :binary_id), null: true

      # Session characteristics
      add :session_type, :string, null: false # "diagnostic", "repair", "maintenance", "restoration"
      add :start_time, :utc_datetime
      add :end_time, :utc_datetime
      add :duration_minutes, :integer

      # Environmental conditions
      add :weather_condition, :string # "clear", "rain", "snow", "hot", "cold"
      add :temperature, :integer # Fahrenheit
      add :lighting_quality, :string # "natural", "artificial", "poor", "excellent"

      # Work performed
      add :tools_used, {:array, :string}, default: []
      add :parts_installed, {:array, :string}, default: []
      add :completion_status, :string # "completed", "in_progress", "abandoned", "needs_parts"

      # Quality indicators
      add :photo_count, :integer, default: 0
      add :tag_count, :integer, default: 0
      add :quality_score, :integer, default: 0

      timestamps(type: :utc_datetime)
    end

    # Location patterns - detected behavioral patterns
    create table(:location_patterns, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :work_location_id, references(:work_locations, type: :binary_id, on_delete: :delete_all), null: false

      # Pattern identification
      add :pattern_type, :string, null: false # "tool_usage", "work_schedule", "quality_level"
      add :pattern_name, :string, null: false
      add :confidence, :float, null: false # 0.0 - 1.0

      # Pattern data
      add :frequency, :integer # How often this pattern occurs
      add :consistency, :float # How consistent the pattern is
      add :trend, :string # "increasing", "stable", "decreasing"

      # Pattern metadata
      add :first_detected, :utc_datetime
      add :last_confirmed, :utc_datetime
      add :sample_size, :integer # Number of data points supporting pattern

      # Pattern details
      add :pattern_data, :map, default: %{} # JSONB for specific pattern details

      timestamps(type: :utc_datetime)
    end

    # Indexes for performance
    create index(:work_locations, [:user_id])
    create index(:work_locations, [:location_type])
    create index(:work_locations, [:work_context])
    create index(:work_locations, [:tool_quality_score])
    create index(:work_locations, [:confidence_score])

    create index(:location_sessions, [:work_location_id])
    create index(:location_sessions, [:user_id])
    create index(:location_sessions, [:vehicle_id])
    create index(:location_sessions, [:session_type])
    create index(:location_sessions, [:start_time])

    create index(:location_patterns, [:work_location_id])
    create index(:location_patterns, [:pattern_type])
    create index(:location_patterns, [:confidence])
  end
end