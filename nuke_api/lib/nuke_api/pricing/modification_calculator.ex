defmodule NukeApi.Pricing.ModificationCalculator do
  @moduledoc """
  Advanced Modification Value Impact Calculator

  This module provides sophisticated algorithms to calculate how vehicle modifications
  affect market value based on visual evidence, market data, and industry knowledge.

  Key Features:
  - Brand-specific value calculations
  - Quality assessment through visual verification
  - Market demand analysis
  - Installation quality impact
  - Depreciation modeling
  - Synergy bonuses for complementary modifications
  """

  require Logger
  alias NukeApi.Pricing.ModificationImpact
  alias NukeApi.Repo
  import Ecto.Query

  @doc """
  Calculate comprehensive modification impact for a vehicle.

  Returns total modification value and detailed breakdown by modification.
  """
  def calculate_modification_impact(vehicle) do
    modification_tags = get_verified_modification_tags(vehicle)

    if Enum.empty?(modification_tags) do
      {:ok, Decimal.new("0")}
    else
      modifications = modification_tags
      |> Enum.map(&analyze_modification/1)
      |> apply_synergy_bonuses()
      |> apply_vehicle_specific_factors(vehicle)

      # Store detailed modification impacts
      Enum.each(modifications, &store_modification_impact(&1, vehicle.id))

      total_impact = modifications
      |> Enum.map(&Map.get(&1, :current_value_impact, Decimal.new("0")))
      |> Enum.reduce(Decimal.new("0"), &Decimal.add/2)

      {:ok, total_impact}
    end
  end

  @doc """
  Analyze a single modification tag to determine its value impact.
  """
  def analyze_modification(tag) do
    base_analysis = %{
      tag_id: tag.id,
      modification_name: tag.text,
      modification_type: classify_modification_type(tag.text),
      brand: extract_brand(tag.text),
      visual_verification_score: calculate_visual_verification_score(tag),
      base_value: calculate_base_modification_value(tag.text),
      quality_multiplier: assess_installation_quality(tag),
      market_demand: assess_market_demand(tag.text),
      depreciation_rate: calculate_depreciation_rate(tag.text)
    }

    # Calculate final value impact
    current_value = base_analysis.base_value
    |> Decimal.mult(Decimal.from_float(base_analysis.quality_multiplier))
    |> apply_market_demand_adjustment(base_analysis.market_demand)
    |> apply_visual_verification_bonus(base_analysis.visual_verification_score)

    Map.put(base_analysis, :current_value_impact, current_value)
  end

  # Advanced modification categorization and value calculations

  defp classify_modification_type(modification_text) do
    text = String.downcase(modification_text)

    cond do
      performance_modification?(text) -> "performance"
      aesthetic_modification?(text) -> "aesthetic"
      functional_modification?(text) -> "functional"
      true -> "aesthetic"  # Default fallback
    end
  end

  defp performance_modification?(text) do
    performance_keywords = [
      "turbo", "supercharg", "nitrous", "nos", "cam", "pistons", "headers",
      "exhaust", "intake", "chip", "tune", "ecu", "transmission", "clutch",
      "differential", "suspension", "coilovers", "shocks", "struts", "sway bar",
      "brake", "rotor", "caliper", "engine swap", "motor swap", "intercooler"
    ]

    Enum.any?(performance_keywords, &String.contains?(text, &1))
  end

  defp aesthetic_modification?(text) do
    aesthetic_keywords = [
      "wheels", "rims", "tires", "paint", "wrap", "decal", "sticker",
      "body kit", "spoiler", "wing", "bumper", "grill", "lights", "led",
      "xenon", "tint", "interior", "seats", "steering wheel", "shift knob"
    ]

    Enum.any?(aesthetic_keywords, &String.contains?(text, &1))
  end

  defp functional_modification?(text) do
    functional_keywords = [
      "lift kit", "leveling kit", "winch", "bumper", "skid plate", "rock slider",
      "roof rack", "cargo", "hitch", "trailer", "air conditioning", "heater",
      "stereo", "radio", "navigation", "backup camera", "dash cam"
    ]

    Enum.any?(functional_keywords, &String.contains?(text, &1))
  end

  defp extract_brand(modification_text) do
    # Common performance and modification brands
    brands = %{
      # Performance brands
      "k&n" => "K&N",
      "cold air inductions" => "Cold Air Inductions",
      "aem" => "AEM",
      "borla" => "Borla",
      "magnaflow" => "MagnaFlow",
      "flowmaster" => "Flowmaster",
      "mishimoto" => "Mishimoto",
      "bilstein" => "Bilstein",
      "fox" => "Fox Racing",
      "king" => "King Shocks",
      "eibach" => "Eibach",
      "whiteline" => "Whiteline",

      # Wheel brands
      "bbs" => "BBS",
      "enkei" => "Enkei",
      "oz racing" => "OZ Racing",
      "adv1" => "ADV.1",
      "hre" => "HRE",
      "vossen" => "Vossen",
      "rotiform" => "Rotiform",
      "fifteen52" => "Fifteen52",

      # Turbo/Supercharger brands
      "garrett" => "Garrett",
      "borgwarner" => "BorgWarner",
      "vortech" => "Vortech",
      "procharger" => "ProCharger",
      "whipple" => "Whipple"
    }

    text = String.downcase(modification_text)

    brands
    |> Enum.find(fn {keyword, _brand} -> String.contains?(text, keyword) end)
    |> case do
      {_keyword, brand} -> brand
      nil -> nil
    end
  end

  defp calculate_base_modification_value(modification_text) do
    text = String.downcase(modification_text)

    # Sophisticated value calculation based on modification type and complexity
    base_value = cond do
      # Engine internal modifications (highest value)
      String.contains?(text, "engine swap") -> 8000
      String.contains?(text, "motor swap") -> 8000
      String.contains?(text, "turbo") and String.contains?(text, "kit") -> 6000
      String.contains?(text, "supercharger") -> 7000
      String.contains?(text, "nitrous") -> 1500

      # Engine supporting mods
      String.contains?(text, "turbo") -> 3000
      String.contains?(text, "intercooler") -> 800
      String.contains?(text, "headers") -> 1200
      String.contains?(text, "cam") -> 1500
      String.contains?(text, "pistons") -> 2000
      String.contains?(text, "tune") or String.contains?(text, "chip") -> 500

      # Exhaust system
      String.contains?(text, "exhaust") and String.contains?(text, "system") -> 1200
      String.contains?(text, "exhaust") -> 600
      String.contains?(text, "muffler") -> 300

      # Intake system
      String.contains?(text, "cold air intake") -> 250
      String.contains?(text, "intake") -> 200

      # Suspension (varies greatly by type)
      String.contains?(text, "coilovers") -> 2000
      String.contains?(text, "air suspension") -> 3500
      String.contains?(text, "lift kit") -> 2500
      String.contains?(text, "leveling kit") -> 800
      String.contains?(text, "suspension") -> 1500
      String.contains?(text, "shocks") -> 800
      String.contains?(text, "struts") -> 900

      # Wheels and tires
      String.contains?(text, "wheels") and String.contains?(text, "tires") -> 2000
      String.contains?(text, "wheels") -> 1200
      String.contains?(text, "rims") -> 1200
      String.contains?(text, "tires") -> 600

      # Brakes
      String.contains?(text, "big brake") -> 3000
      String.contains?(text, "brake kit") -> 2500
      String.contains?(text, "brake") -> 800

      # Drivetrain
      String.contains?(text, "transmission") -> 4000
      String.contains?(text, "clutch") -> 1200
      String.contains?(text, "differential") -> 2000

      # Body modifications
      String.contains?(text, "body kit") -> 2000
      String.contains?(text, "bumper") -> 800
      String.contains?(text, "wing") -> 600
      String.contains?(text, "spoiler") -> 400

      # Interior
      String.contains?(text, "seats") -> 1500
      String.contains?(text, "roll cage") -> 2500
      String.contains?(text, "interior") -> 1000

      # Lighting
      String.contains?(text, "led") -> 300
      String.contains?(text, "xenon") -> 500
      String.contains?(text, "lights") -> 200

      # Audio/Electronics
      String.contains?(text, "stereo") -> 800
      String.contains?(text, "navigation") -> 600

      # Truck/SUV specific
      String.contains?(text, "winch") -> 1200
      String.contains?(text, "bumper") and String.contains?(text, "heavy duty") -> 1500
      String.contains?(text, "skid plate") -> 400
      String.contains?(text, "rock slider") -> 800

      # Default for unrecognized modifications
      true -> 200
    end

    Decimal.new(to_string(base_value))
  end

  defp calculate_visual_verification_score(tag) do
    # Base score from tag verification status and trust score
    base_score = case tag.verification_status do
      "verified" -> 80.0
      "peer_verified" -> 70.0
      "pending" -> 30.0
      "disputed" -> 10.0
      "rejected" -> 0.0
      _ -> 30.0
    end

    # Adjust by trust score
    trust_adjustment = (tag.trust_score || 10) / 10.0 * 20.0

    min(base_score + trust_adjustment, 100.0)
  end

  defp assess_installation_quality(tag) do
    # Quality assessment based on visual evidence and tag metadata
    visual_score = calculate_visual_verification_score(tag)

    cond do
      visual_score >= 90 -> 1.2  # Professional installation bonus
      visual_score >= 70 -> 1.0  # Good quality installation
      visual_score >= 50 -> 0.9  # Average installation
      visual_score >= 30 -> 0.7  # Poor installation
      true -> 0.5              # Very poor installation
    end
  end

  defp assess_market_demand(modification_text) do
    text = String.downcase(modification_text)

    # Market demand assessment based on current trends
    cond do
      # High demand modifications
      String.contains?(text, "turbo") -> "high"
      String.contains?(text, "lift kit") -> "high"
      String.contains?(text, "wheels") -> "high"
      String.contains?(text, "exhaust") -> "high"

      # Medium demand modifications
      String.contains?(text, "intake") -> "medium"
      String.contains?(text, "suspension") -> "medium"
      String.contains?(text, "brake") -> "medium"

      # Lower demand modifications
      String.contains?(text, "sticker") -> "low"
      String.contains?(text, "decal") -> "low"
      String.contains?(text, "tint") -> "medium"

      # Default
      true -> "medium"
    end
  end

  defp calculate_depreciation_rate(modification_text) do
    text = String.downcase(modification_text)

    # Different modification types depreciate at different rates
    cond do
      # Structural/permanent modifications hold value better
      String.contains?(text, "engine swap") -> 0.05
      String.contains?(text, "turbo") -> 0.08
      String.contains?(text, "suspension") -> 0.10
      String.contains?(text, "brake") -> 0.12

      # Consumable modifications depreciate faster
      String.contains?(text, "tires") -> 0.25
      String.contains?(text, "intake") -> 0.15
      String.contains?(text, "exhaust") -> 0.12

      # Aesthetic modifications vary widely
      String.contains?(text, "wheels") -> 0.15
      String.contains?(text, "paint") -> 0.20
      String.contains?(text, "wrap") -> 0.30

      # Electronics depreciate quickly
      String.contains?(text, "stereo") -> 0.25
      String.contains?(text, "navigation") -> 0.30

      # Default depreciation rate
      true -> 0.15
    end
  end

  defp apply_market_demand_adjustment(value, demand) do
    multiplier = case demand do
      "high" -> 1.15
      "medium" -> 1.0
      "low" -> 0.85
    end

    Decimal.mult(value, Decimal.from_float(multiplier))
  end

  defp apply_visual_verification_bonus(value, verification_score) do
    # Bonus for high-quality visual evidence
    bonus_multiplier = case verification_score do
      score when score >= 90 -> 1.10
      score when score >= 80 -> 1.05
      score when score >= 70 -> 1.0
      _ -> 0.95
    end

    Decimal.mult(value, Decimal.from_float(bonus_multiplier))
  end

  defp apply_synergy_bonuses(modifications) do
    # Apply bonuses for complementary modifications
    modifications
    |> add_turbo_system_synergy()
    |> add_suspension_wheel_synergy()
    |> add_engine_supporting_mods_synergy()
  end

  defp add_turbo_system_synergy(modifications) do
    has_turbo = Enum.any?(modifications, fn mod ->
      String.contains?(String.downcase(mod.modification_name), "turbo")
    end)

    has_intercooler = Enum.any?(modifications, fn mod ->
      String.contains?(String.downcase(mod.modification_name), "intercooler")
    end)

    has_tune = Enum.any?(modifications, fn mod ->
      text = String.downcase(mod.modification_name)
      String.contains?(text, "tune") or String.contains?(text, "chip")
    end)

    if has_turbo and has_intercooler and has_tune do
      # Apply 15% synergy bonus to turbo system components
      Enum.map(modifications, fn mod ->
        if turbo_related?(mod.modification_name) do
          bonus = Decimal.mult(mod.current_value_impact, Decimal.from_float(0.15))
          Map.update!(mod, :current_value_impact, &Decimal.add(&1, bonus))
        else
          mod
        end
      end)
    else
      modifications
    end
  end

  defp turbo_related?(name) do
    text = String.downcase(name)
    String.contains?(text, "turbo") or
    String.contains?(text, "intercooler") or
    String.contains?(text, "tune") or
    String.contains?(text, "chip")
  end

  defp add_suspension_wheel_synergy(modifications) do
    has_suspension = Enum.any?(modifications, fn mod ->
      String.contains?(String.downcase(mod.modification_name), "suspension")
    end)

    has_wheels = Enum.any?(modifications, fn mod ->
      text = String.downcase(mod.modification_name)
      String.contains?(text, "wheels") or String.contains?(text, "rims")
    end)

    if has_suspension and has_wheels do
      # Apply 10% synergy bonus
      Enum.map(modifications, fn mod ->
        if suspension_wheel_related?(mod.modification_name) do
          bonus = Decimal.mult(mod.current_value_impact, Decimal.from_float(0.10))
          Map.update!(mod, :current_value_impact, &Decimal.add(&1, bonus))
        else
          mod
        end
      end)
    else
      modifications
    end
  end

  defp suspension_wheel_related?(name) do
    text = String.downcase(name)
    String.contains?(text, "suspension") or
    String.contains?(text, "wheels") or
    String.contains?(text, "rims") or
    String.contains?(text, "coilovers")
  end

  defp add_engine_supporting_mods_synergy(modifications) do
    engine_mod_count = modifications
    |> Enum.count(fn mod ->
      text = String.downcase(mod.modification_name)
      String.contains?(text, "intake") or
      String.contains?(text, "exhaust") or
      String.contains?(text, "headers") or
      String.contains?(text, "cam") or
      String.contains?(text, "tune")
    end)

    if engine_mod_count >= 3 do
      # Apply progressive bonus for complete engine builds
      bonus_multiplier = min(0.05 + (engine_mod_count - 3) * 0.02, 0.15)

      Enum.map(modifications, fn mod ->
        if engine_supporting_mod?(mod.modification_name) do
          bonus = Decimal.mult(mod.current_value_impact, Decimal.from_float(bonus_multiplier))
          Map.update!(mod, :current_value_impact, &Decimal.add(&1, bonus))
        else
          mod
        end
      end)
    else
      modifications
    end
  end

  defp engine_supporting_mod?(name) do
    text = String.downcase(name)
    String.contains?(text, "intake") or
    String.contains?(text, "exhaust") or
    String.contains?(text, "headers") or
    String.contains?(text, "cam") or
    String.contains?(text, "tune") or
    String.contains?(text, "chip")
  end

  defp apply_vehicle_specific_factors(modifications, vehicle) do
    # Apply vehicle-specific adjustments based on make/model/year
    base_value_multiplier = calculate_base_value_multiplier(vehicle)

    Enum.map(modifications, fn mod ->
      adjusted_value = Decimal.mult(mod.current_value_impact, Decimal.from_float(base_value_multiplier))
      Map.put(mod, :current_value_impact, adjusted_value)
    end)
  end

  defp calculate_base_value_multiplier(vehicle) do
    # Higher-end vehicles typically see better modification value retention
    case String.downcase(vehicle.make || "") do
      "ferrari" -> 1.5
      "lamborghini" -> 1.5
      "porsche" -> 1.3
      "bmw" -> 1.2
      "mercedes" -> 1.2
      "audi" -> 1.1
      "lexus" -> 1.1
      "acura" -> 1.1
      "infiniti" -> 1.1
      "cadillac" -> 1.05
      _ -> 1.0  # Standard multiplier for mainstream brands
    end
  end

  defp get_verified_modification_tags(vehicle) do
    vehicle.images
    |> Enum.flat_map(&(&1.tags))
    |> Enum.filter(fn tag ->
      tag.tag_type == "modification" and
      tag.verification_status in ["verified", "peer_verified"]
    end)
  end

  defp store_modification_impact(modification, vehicle_id) do
    attrs = %{
      vehicle_id: vehicle_id,
      image_tag_id: modification.tag_id,
      modification_type: modification.modification_type,
      modification_name: modification.modification_name,
      brand: modification.brand,
      current_value_impact: modification.current_value_impact,
      visual_verification_score: modification.visual_verification_score,
      market_demand: modification.market_demand,
      depreciation_rate: modification.depreciation_rate,
      installation_quality: assess_installation_quality_string(modification.quality_multiplier)
    }

    changeset = ModificationImpact.changeset(%ModificationImpact{}, attrs)

    case Repo.insert(changeset) do
      {:ok, _} -> :ok
      {:error, changeset} ->
        Logger.error("Failed to store modification impact: #{inspect(changeset.errors)}")
        :error
    end
  end

  defp assess_installation_quality_string(quality_multiplier) do
    cond do
      quality_multiplier >= 1.1 -> "professional"
      quality_multiplier >= 0.95 -> "diy_good"
      true -> "diy_poor"
    end
  end
end