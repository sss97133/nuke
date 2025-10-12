defmodule NukeApi.Services.Shop do
  @moduledoc """
  Schema for automotive service shops and businesses.

  Tracks service locations, capabilities, and business intelligence
  for corporate B2B targeting and market analysis.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "shops" do
    field :name, :string
    field :business_type, :string
    field :license_number, :string
    field :certifications, {:array, :string}, default: []
    field :services_offered, {:array, :string}, default: []
    field :contact_info, :map, default: %{}
    field :address, :map, default: %{}
    field :business_hours, :map, default: %{}
    field :specializes_in, {:array, :string}, default: []
    field :equipment_available, {:array, :string}, default: []
    field :active, :boolean, default: true

    # Associations
    has_many :technicians, NukeApi.Services.Technician
    has_many :spatial_tags, NukeApi.Vehicles.SpatialTag

    timestamps(type: :utc_datetime)
  end

  @business_types [
    "dealership",
    "independent",
    "chain",
    "mobile",
    "diy_garage",
    "specialty_shop",
    "fleet_service",
    "racing_shop"
  ]

  @certifications [
    "ase_blue_seal",
    "aaa_approved",
    "manufacturer_authorized",
    "napa_autocare",
    "bosch_service",
    "ac_delco_professional",
    "carquest_technical_institute"
  ]

  @services [
    "oil_change",
    "brake_service",
    "transmission_service",
    "engine_repair",
    "electrical_repair",
    "air_conditioning",
    "diagnostic",
    "bodywork",
    "paint",
    "restoration",
    "performance_tuning",
    "fabrication",
    "welding",
    "towing"
  ]

  @vehicle_specializations [
    "domestic",
    "import",
    "luxury",
    "classic",
    "performance",
    "diesel",
    "hybrid_electric",
    "motorcycle",
    "commercial",
    "heavy_duty"
  ]

  @equipment [
    "alignment_rack",
    "tire_machine",
    "lift",
    "diagnostic_scanner",
    "brake_lathe",
    "paint_booth",
    "welding_equipment",
    "transmission_flush",
    "ac_machine",
    "emissions_equipment"
  ]

  @required_fields [:name, :business_type]
  @optional_fields [:license_number, :certifications, :services_offered,
                    :contact_info, :address, :business_hours, :specializes_in,
                    :equipment_available, :active]

  def changeset(shop, attrs) do
    shop
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:business_type, @business_types)
    |> validate_certifications()
    |> validate_services()
    |> validate_specializations()
    |> validate_equipment()
    |> validate_length(:name, min: 2, max: 200)
  end

  defp validate_certifications(changeset) do
    certifications = get_field(changeset, :certifications) || []
    invalid = certifications -- @certifications

    if Enum.empty?(invalid) do
      changeset
    else
      add_error(changeset, :certifications, "contains invalid certifications: #{inspect(invalid)}")
    end
  end

  defp validate_services(changeset) do
    services = get_field(changeset, :services_offered) || []
    invalid = services -- @services

    if Enum.empty?(invalid) do
      changeset
    else
      add_error(changeset, :services_offered, "contains invalid services: #{inspect(invalid)}")
    end
  end

  defp validate_specializations(changeset) do
    specializations = get_field(changeset, :specializes_in) || []
    invalid = specializations -- @vehicle_specializations

    if Enum.empty?(invalid) do
      changeset
    else
      add_error(changeset, :specializes_in, "contains invalid specializations: #{inspect(invalid)}")
    end
  end

  defp validate_equipment(changeset) do
    equipment = get_field(changeset, :equipment_available) || []
    invalid = equipment -- @equipment

    if Enum.empty?(invalid) do
      changeset
    else
      add_error(changeset, :equipment_available, "contains invalid equipment: #{inspect(invalid)}")
    end
  end

  @doc """
  Calculates business sophistication score for corporate targeting.
  """
  def calculate_business_score(shop) do
    score = 0

    # Business type scoring
    type_score = case shop.business_type do
      "dealership" -> 30
      "chain" -> 25
      "specialty_shop" -> 20
      "independent" -> 15
      "racing_shop" -> 15
      "fleet_service" -> 20
      _ -> 5
    end

    # Certification scoring
    cert_count = length(shop.certifications || [])
    cert_score = min(cert_count * 8, 24)

    # Service diversity scoring
    service_count = length(shop.services_offered || [])
    service_score = min(service_count * 2, 20)

    # Equipment sophistication scoring
    equipment_count = length(shop.equipment_available || [])
    equipment_score = min(equipment_count * 3, 21)

    total = score + type_score + cert_score + service_score + equipment_score
    min(total, 100)
  end

  @doc """
  Determines shop's purchasing power tier for B2B targeting.
  """
  def purchasing_power_tier(shop) do
    business_score = calculate_business_score(shop)
    tech_count = length(shop.technicians || [])

    cond do
      business_score >= 80 and tech_count >= 10 -> "enterprise"
      business_score >= 60 and tech_count >= 5 -> "professional"
      business_score >= 40 and tech_count >= 2 -> "small_business"
      true -> "startup"
    end
  end

  @doc """
  Generates corporate intelligence report for market analysis.
  """
  def generate_market_intelligence(shop) do
    business_score = calculate_business_score(shop)
    purchasing_tier = purchasing_power_tier(shop)

    %{
      shop_id: shop.id,
      business_score: business_score,
      purchasing_power_tier: purchasing_tier,
      market_segment: determine_market_segment(shop),
      service_capacity: estimate_service_capacity(shop),
      equipment_investment: calculate_equipment_value(shop),
      growth_indicators: analyze_growth_indicators(shop),
      corporate_targeting_value: calculate_targeting_value(shop)
    }
  end

  defp determine_market_segment(shop) do
    case shop.business_type do
      "dealership" -> "oem_authorized"
      "chain" -> "franchise_network"
      "specialty_shop" -> "niche_specialist"
      "racing_shop" -> "performance_aftermarket"
      "fleet_service" -> "commercial_b2b"
      _ -> "independent_aftermarket"
    end
  end

  defp estimate_service_capacity(shop) do
    # Estimate based on services offered and equipment
    base_capacity = length(shop.services_offered || []) * 10

    # Equipment multiplier
    equipment_multiplier = case length(shop.equipment_available || []) do
      n when n >= 8 -> 1.5
      n when n >= 5 -> 1.2
      n when n >= 3 -> 1.1
      _ -> 1.0
    end

    round(base_capacity * equipment_multiplier)
  end

  defp calculate_equipment_value(shop) do
    equipment = shop.equipment_available || []

    # Rough equipment value estimates
    equipment_values = %{
      "alignment_rack" => 50000,
      "paint_booth" => 75000,
      "lift" => 8000,
      "diagnostic_scanner" => 5000,
      "tire_machine" => 15000,
      "brake_lathe" => 12000,
      "welding_equipment" => 3000,
      "transmission_flush" => 8000,
      "ac_machine" => 4000,
      "emissions_equipment" => 25000
    }

    total_value = equipment
      |> Enum.map(&Map.get(equipment_values, &1, 2000))
      |> Enum.sum()

    %{
      estimated_equipment_value: total_value,
      equipment_count: length(equipment),
      high_value_equipment: Enum.count(equipment, &(Map.get(equipment_values, &1, 0) > 20000))
    }
  end

  defp analyze_growth_indicators(shop) do
    # Analyze factors that indicate business growth potential
    service_diversity = length(shop.services_offered || [])
    equipment_sophistication = length(shop.equipment_available || [])
    certification_level = length(shop.certifications || [])

    growth_score = (service_diversity * 2) + (equipment_sophistication * 3) + (certification_level * 4)

    %{
      growth_score: min(growth_score, 100),
      service_diversity: service_diversity,
      equipment_sophistication: equipment_sophistication,
      certification_level: certification_level,
      expansion_potential: cond do
        growth_score >= 60 -> "high"
        growth_score >= 30 -> "moderate"
        true -> "limited"
      end
    }
  end

  defp calculate_targeting_value(shop) do
    # Corporate targeting value for parts/tool sales, financing, etc.
    business_score = calculate_business_score(shop)
    equipment_value = calculate_equipment_value(shop).estimated_equipment_value

    base_value = business_score * 0.6

    # Equipment investment indicates purchasing power
    equipment_factor = cond do
      equipment_value > 100000 -> 30
      equipment_value > 50000 -> 20
      equipment_value > 20000 -> 10
      true -> 5
    end

    # Business type targeting value
    type_value = case shop.business_type do
      "dealership" -> 25
      "chain" -> 20
      "specialty_shop" -> 15
      "fleet_service" -> 15
      _ -> 10
    end

    total_value = base_value + equipment_factor + type_value
    min(round(total_value), 100)
  end

  @doc """
  Finds shops capable of specific services.
  """
  def capable_of_service?(shop, required_service, required_equipment \\ []) do
    unless shop.active do
      false
    else

    # Check if shop offers the required service
    service_offered = required_service in (shop.services_offered || [])

    # Check if shop has required equipment
    equipment_available = case required_equipment do
      [] -> true
      equipment -> Enum.all?(equipment, &(&1 in (shop.equipment_available || [])))
    end

    service_offered and equipment_available
    end
  end
end