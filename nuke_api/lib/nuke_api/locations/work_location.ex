defmodule NukeApi.Locations.WorkLocation do
  @moduledoc """
  Schema for work locations - foundational location contexts where vehicle work happens.

  This captures the environmental and contextual patterns rather than just GPS coordinates.
  Focuses on detecting professional vs personal contexts through behavioral patterns.
  """

  use Ecto.Schema
  import Ecto.Changeset
  alias NukeApi.Locations.{LocationSession, LocationPattern}

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "work_locations" do
    field :user_id, :binary_id

    # Core classification
    field :location_type, :string
    field :work_context, :string
    field :primary_use, :string

    # Physical characteristics
    field :space_size, :string
    field :surface_type, :string
    field :covered, :boolean, default: false
    field :climate_controlled, :boolean, default: false

    # Equipment and infrastructure
    field :has_lift, :boolean, default: false
    field :has_compressor, :boolean, default: false
    field :has_welding, :boolean, default: false
    field :has_specialty_tools, :boolean, default: false
    field :power_available, :string

    # Professional indicators
    field :business_license, :boolean, default: false
    field :insurance_type, :string
    field :certification_level, :string

    # Pattern detection scores
    field :tool_quality_score, :integer, default: 0
    field :organization_score, :integer, default: 0
    field :frequency_score, :integer, default: 0

    # Location metadata
    field :name, :string
    field :description, :string
    field :address, :string
    field :latitude, :decimal
    field :longitude, :decimal
    field :timezone, :string

    # Pattern analysis
    field :detected_patterns, :map, default: %{}
    field :confidence_score, :integer, default: 0

    # Associations
    has_many :sessions, LocationSession, foreign_key: :work_location_id
    has_many :patterns, LocationPattern, foreign_key: :work_location_id

    timestamps(type: :utc_datetime)
  end

  @location_types ["home", "shop", "mobile", "outdoor", "commercial", "dealership"]
  @work_contexts ["personal", "professional", "commercial", "hobbyist", "diy", "expert"]
  @primary_uses ["restoration", "maintenance", "repair", "fabrication", "diagnostic", "detailing"]
  @space_sizes ["single_bay", "double_bay", "multi_bay", "driveway", "yard", "street"]
  @surface_types ["concrete", "asphalt", "gravel", "dirt", "epoxy_coated", "tile"]
  @power_levels ["basic_110", "220_available", "industrial_power", "limited"]
  @insurance_types ["none", "personal", "commercial", "professional", "specialty"]
  @certification_levels ["none", "ase", "manufacturer", "specialty", "master_tech"]

  @required_fields [:user_id, :location_type, :work_context, :primary_use]
  @optional_fields [:space_size, :surface_type, :covered, :climate_controlled,
                   :has_lift, :has_compressor, :has_welding, :has_specialty_tools,
                   :power_available, :business_license, :insurance_type,
                   :certification_level, :tool_quality_score, :organization_score,
                   :frequency_score, :name, :description, :address, :latitude,
                   :longitude, :timezone, :detected_patterns, :confidence_score]

  def changeset(work_location, attrs) do
    work_location
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:location_type, @location_types)
    |> validate_inclusion(:work_context, @work_contexts)
    |> validate_inclusion(:primary_use, @primary_uses)
    |> validate_inclusion(:space_size, @space_sizes)
    |> validate_inclusion(:surface_type, @surface_types)
    |> validate_inclusion(:power_available, @power_levels)
    |> validate_inclusion(:insurance_type, @insurance_types)
    |> validate_inclusion(:certification_level, @certification_levels)
    |> validate_number(:tool_quality_score, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_number(:organization_score, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_number(:frequency_score, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_number(:confidence_score, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_number(:latitude, greater_than_or_equal_to: -90, less_than_or_equal_to: 90)
    |> validate_number(:longitude, greater_than_or_equal_to: -180, less_than_or_equal_to: 180)
  end

  @doc """
  Determines the professional level based on multiple factors.
  """
  def calculate_professional_level(work_location) do
    factors = [
      professional_equipment_score(work_location),
      certification_score(work_location),
      infrastructure_score(work_location),
      pattern_consistency_score(work_location)
    ]

    average_score = factors |> Enum.sum() |> div(length(factors))

    cond do
      average_score >= 80 -> "professional"
      average_score >= 60 -> "experienced"
      average_score >= 40 -> "hobbyist"
      true -> "diy"
    end
  end

  defp professional_equipment_score(work_location) do
    score = 0
    score = if work_location.has_lift, do: score + 25, else: score
    score = if work_location.has_compressor, do: score + 15, else: score
    score = if work_location.has_welding, do: score + 15, else: score
    score = if work_location.has_specialty_tools, do: score + 20, else: score
    score = score + (work_location.tool_quality_score || 0) * 0.25

    min(score, 100)
  end

  defp certification_score(work_location) do
    case work_location.certification_level do
      "master_tech" -> 100
      "ase" -> 80
      "manufacturer" -> 70
      "specialty" -> 60
      _ -> 0
    end
  end

  defp infrastructure_score(work_location) do
    score = 0
    score = if work_location.covered, do: score + 20, else: score
    score = if work_location.climate_controlled, do: score + 20, else: score
    score = if work_location.business_license, do: score + 30, else: score

    score = score + case work_location.power_available do
      "industrial_power" -> 30
      "220_available" -> 20
      "basic_110" -> 10
      _ -> 0
    end

    min(score, 100)
  end

  defp pattern_consistency_score(work_location) do
    (work_location.organization_score || 0) + (work_location.frequency_score || 0)
    |> div(2)
  end

  @doc """
  Analyzes location context from image patterns and metadata.
  """
  def analyze_from_patterns(detected_tools, work_environment, session_data) do
    tool_analysis = analyze_tool_patterns(detected_tools)
    environment_analysis = analyze_environment_patterns(work_environment)
    session_analysis = analyze_session_patterns(session_data)

    %{
      suggested_location_type: determine_location_type(environment_analysis),
      suggested_work_context: determine_work_context(tool_analysis, session_analysis),
      tool_quality_score: tool_analysis.quality_score,
      organization_score: environment_analysis.organization_score,
      confidence_score: calculate_confidence(tool_analysis, environment_analysis, session_analysis)
    }
  end

  defp analyze_tool_patterns(detected_tools) do
    premium_brands = ["snap-on", "mac", "matco", "cornwell", "milwaukee", "dewalt"]
    budget_brands = ["harbor-freight", "husky", "kobalt", "craftsman"]

    premium_count = Enum.count(detected_tools, &String.downcase(&1) in premium_brands)
    budget_count = Enum.count(detected_tools, &String.downcase(&1) in budget_brands)

    quality_score = cond do
      premium_count > budget_count * 2 -> 90
      premium_count > budget_count -> 70
      budget_count > premium_count -> 40
      true -> 60
    end

    %{
      quality_score: quality_score,
      tool_count: length(detected_tools),
      premium_ratio: premium_count / max(length(detected_tools), 1)
    }
  end

  defp analyze_environment_patterns(work_environment) do
    organization_indicators = [
      work_environment[:clean_workspace] || false,
      work_environment[:organized_tools] || false,
      work_environment[:proper_lighting] || false,
      work_environment[:professional_surfaces] || false
    ]

    organization_score = organization_indicators
    |> Enum.count(& &1)
    |> Kernel.*(25)

    %{
      organization_score: organization_score,
      surface_quality: work_environment[:surface_quality] || "unknown",
      lighting_quality: work_environment[:lighting_quality] || "unknown"
    }
  end

  defp analyze_session_patterns(session_data) do
    %{
      frequency: session_data[:weekly_sessions] || 0,
      average_duration: session_data[:avg_duration_hours] || 0,
      consistency: session_data[:schedule_consistency] || 0
    }
  end

  defp determine_location_type(environment_analysis) do
    cond do
      environment_analysis.surface_quality == "epoxy_coated" -> "shop"
      environment_analysis.lighting_quality == "professional" -> "shop"
      environment_analysis.organization_score >= 75 -> "shop"
      true -> "home"
    end
  end

  defp determine_work_context(tool_analysis, session_analysis) do
    cond do
      tool_analysis.premium_ratio >= 0.7 && session_analysis.frequency >= 3 -> "professional"
      tool_analysis.quality_score >= 70 && session_analysis.consistency >= 0.8 -> "experienced"
      session_analysis.frequency >= 2 -> "hobbyist"
      true -> "personal"
    end
  end

  defp calculate_confidence(tool_analysis, environment_analysis, session_analysis) do
    factors = [
      tool_analysis.tool_count > 5, # Has sufficient tool data
      environment_analysis.organization_score > 0, # Has environment data
      session_analysis.frequency > 0 # Has session history
    ]

    base_confidence = factors |> Enum.count(& &1) |> Kernel.*(25)

    # Boost confidence if patterns are consistent
    consistency_boost = if session_analysis.consistency > 0.7, do: 15, else: 0

    min(base_confidence + consistency_boost, 100)
  end
end