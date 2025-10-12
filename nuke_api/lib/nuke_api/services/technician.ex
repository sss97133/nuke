defmodule NukeApi.Services.Technician do
  @moduledoc """
  Schema for automotive technicians who perform work on vehicles.

  Tracks professional credentials, specializations, and service history
  for corporate data harvesting of professional service networks.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "technicians" do
    field :name, :string
    field :license_number, :string
    field :certification_level, :string
    field :specializations, {:array, :string}, default: []
    field :hourly_rate_cents, :integer
    field :experience_years, :integer
    field :contact_info, :map, default: %{}
    field :active, :boolean, default: true

    # Associations
    belongs_to :shop, NukeApi.Services.Shop
    has_many :spatial_tags, NukeApi.Vehicles.SpatialTag

    timestamps(type: :utc_datetime)
  end

  @certification_levels [
    "apprentice",
    "journeyman",
    "master",
    "ase_certified",
    "manufacturer_certified",
    "specialist"
  ]

  @specializations [
    "engine",
    "transmission",
    "electrical",
    "brakes",
    "suspension",
    "air_conditioning",
    "diagnostic",
    "bodywork",
    "paint",
    "fabrication",
    "restoration",
    "performance",
    "diesel",
    "hybrid_electric",
    "motorcycle",
    "heavy_equipment"
  ]

  @required_fields [:name]
  @optional_fields [:license_number, :certification_level, :specializations,
                    :shop_id, :hourly_rate_cents, :experience_years,
                    :contact_info, :active]

  def changeset(technician, attrs) do
    technician
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:certification_level, @certification_levels)
    |> validate_specializations()
    |> validate_number(:hourly_rate_cents, greater_than_or_equal_to: 0)
    |> validate_number(:experience_years, greater_than_or_equal_to: 0, less_than_or_equal_to: 60)
    |> validate_length(:name, min: 2, max: 100)
    |> foreign_key_constraint(:shop_id)
  end

  defp validate_specializations(changeset) do
    specializations = get_field(changeset, :specializations) || []

    invalid_specs = specializations -- @specializations

    if Enum.empty?(invalid_specs) do
      changeset
    else
      add_error(changeset, :specializations, "contains invalid specializations: #{inspect(invalid_specs)}")
    end
  end

  @doc """
  Calculates professional score based on certifications, experience, and specializations.
  """
  def calculate_professional_score(technician) do
    base_score = 0

    # Certification level scoring
    cert_score = case technician.certification_level do
      "master" -> 40
      "ase_certified" -> 35
      "manufacturer_certified" -> 30
      "specialist" -> 25
      "journeyman" -> 20
      "apprentice" -> 10
      _ -> 0
    end

    # Experience scoring (up to 30 points for 15+ years)
    exp_score = min((technician.experience_years || 0) * 2, 30)

    # Specialization diversity (up to 20 points for 4+ specializations)
    spec_count = length(technician.specializations || [])
    spec_score = min(spec_count * 5, 20)

    # Rate indicator (higher rates often indicate higher skill)
    rate_score = if technician.hourly_rate_cents && technician.hourly_rate_cents > 8000 do
      10  # $80+/hour indicates high skill
    else
      0
    end

    total = base_score + cert_score + exp_score + spec_score + rate_score
    min(total, 100)
  end

  @doc """
  Determines if technician is qualified for specific service type.
  """
  def qualified_for_service?(technician, service_category, required_skill_level \\ "basic") do
    unless technician.active do
      false
    else

    # Check if technician has relevant specialization
    relevant_specs = case service_category do
      "engine_repair" -> ["engine", "diagnostic"]
      "electrical_repair" -> ["electrical", "diagnostic"]
      "brake_repair" -> ["brakes"]
      "transmission_repair" -> ["transmission", "diagnostic"]
      "bodywork" -> ["bodywork", "paint"]
      "modification" -> ["performance", "fabrication"]
      _ -> []
    end

    has_specialization = Enum.any?(relevant_specs, &(&1 in (technician.specializations || [])))

    # Check certification level meets requirements
    cert_adequate = case required_skill_level do
      "professional" ->
        technician.certification_level in ["master", "ase_certified", "manufacturer_certified"]
      "advanced" ->
        technician.certification_level in ["master", "ase_certified", "manufacturer_certified", "specialist", "journeyman"]
      "intermediate" ->
        technician.certification_level not in ["apprentice"]
      "basic" ->
        true
    end

    has_specialization and cert_adequate
    end
  end

  @doc """
  Generates corporate intelligence report for technician analysis.
  """
  def generate_intelligence_report(technician) do
    professional_score = calculate_professional_score(technician)

    %{
      technician_id: technician.id,
      professional_score: professional_score,
      certification_tier: certification_tier(technician.certification_level),
      experience_level: experience_level(technician.experience_years),
      specialization_breadth: length(technician.specializations || []),
      estimated_annual_capacity: estimate_annual_capacity(technician),
      market_value: estimate_market_value(technician),
      corporate_targeting_score: calculate_targeting_score(technician)
    }
  end

  defp certification_tier("master"), do: "tier_1"
  defp certification_tier("ase_certified"), do: "tier_1"
  defp certification_tier("manufacturer_certified"), do: "tier_2"
  defp certification_tier("specialist"), do: "tier_2"
  defp certification_tier("journeyman"), do: "tier_3"
  defp certification_tier(_), do: "tier_4"

  defp experience_level(years) when is_nil(years), do: "entry"
  defp experience_level(years) when years < 3, do: "entry"
  defp experience_level(years) when years < 8, do: "intermediate"
  defp experience_level(years) when years < 15, do: "experienced"
  defp experience_level(_), do: "expert"

  defp estimate_annual_capacity(technician) do
    # Rough estimate based on full-time work capacity
    base_hours = 40 * 50 # 40 hours/week, 50 weeks/year

    # Adjust for certification level efficiency
    efficiency = case technician.certification_level do
      "master" -> 1.2
      "ase_certified" -> 1.1
      "specialist" -> 1.1
      _ -> 1.0
    end

    round(base_hours * efficiency)
  end

  defp estimate_market_value(technician) do
    hourly_rate = (technician.hourly_rate_cents || 6000) / 100
    annual_hours = estimate_annual_capacity(technician)

    %{
      hourly_rate_usd: hourly_rate,
      estimated_annual_revenue: hourly_rate * annual_hours,
      market_tier: if(hourly_rate > 80, do: "premium", else: if(hourly_rate > 50, do: "standard", else: "budget"))
    }
  end

  defp calculate_targeting_score(technician) do
    # Score for corporate targeting (parts sales, tool sales, etc.)
    score = 0

    # Higher score for certified techs
    score = score + case technician.certification_level do
      "master" -> 25
      "ase_certified" -> 20
      "specialist" -> 15
      _ -> 5
    end

    # Higher score for diverse specializations
    spec_count = length(technician.specializations || [])
    score = score + min(spec_count * 3, 15)

    # Higher score for established professionals
    exp_score = min((technician.experience_years || 0), 10)
    score = score + exp_score

    # Rate indicates purchasing power
    rate_score = if technician.hourly_rate_cents && technician.hourly_rate_cents > 7500 do
      10
    else
      0
    end

    min(score + rate_score, 60)
  end
end