defmodule NukeApi.Services.Service do
  @moduledoc """
  Schema for automotive services, repairs, and modifications.

  Defines service types, skill requirements, and cost estimations
  for linking to modification tags and tracking work performed.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "services" do
    field :name, :string
    field :category, :string
    field :subcategory, :string
    field :description, :string
    field :estimated_duration_minutes, :integer
    field :skill_level_required, :string
    field :tools_required, {:array, :string}, default: []
    field :typical_cost_range, :map, default: %{}
    field :warranty_period_days, :integer

    # Associations
    has_many :spatial_tags, NukeApi.Vehicles.SpatialTag

    timestamps(type: :utc_datetime)
  end

  @categories [
    "repair",
    "modification",
    "maintenance",
    "diagnostic",
    "installation",
    "restoration",
    "fabrication",
    "performance"
  ]

  @subcategories %{
    "repair" => [
      "engine_repair", "transmission_repair", "brake_repair", "electrical_repair",
      "suspension_repair", "bodywork_repair", "cooling_system_repair", "exhaust_repair"
    ],
    "modification" => [
      "performance_upgrade", "appearance_modification", "suspension_modification",
      "exhaust_modification", "intake_modification", "lighting_modification"
    ],
    "maintenance" => [
      "oil_change", "filter_replacement", "fluid_service", "belt_replacement",
      "scheduled_maintenance", "inspection"
    ],
    "diagnostic" => [
      "computer_scan", "electrical_diagnosis", "performance_analysis",
      "emission_test", "road_test"
    ],
    "installation" => [
      "aftermarket_installation", "accessory_installation", "electronics_installation",
      "safety_equipment_installation"
    ],
    "restoration" => [
      "frame_restoration", "engine_rebuild", "interior_restoration",
      "paint_restoration", "chrome_restoration"
    ],
    "fabrication" => [
      "custom_fabrication", "welding", "metal_work", "roll_cage_fabrication"
    ],
    "performance" => [
      "engine_tuning", "dyno_testing", "turbo_installation", "nitrous_installation"
    ]
  }

  @skill_levels [
    "basic",        # DIY friendly
    "intermediate", # Some experience required
    "advanced",     # Significant expertise needed
    "professional"  # Professional shop only
  ]

  @required_fields [:name, :category, :skill_level_required]
  @optional_fields [:subcategory, :description, :estimated_duration_minutes,
                    :tools_required, :typical_cost_range, :warranty_period_days]

  def changeset(service, attrs) do
    service
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:category, @categories)
    |> validate_inclusion(:skill_level_required, @skill_levels)
    |> validate_subcategory()
    |> validate_number(:estimated_duration_minutes, greater_than: 0)
    |> validate_number(:warranty_period_days, greater_than_or_equal_to: 0)
    |> validate_length(:name, min: 2, max: 200)
  end

  defp validate_subcategory(changeset) do
    category = get_field(changeset, :category)
    subcategory = get_field(changeset, :subcategory)

    if category && subcategory do
      valid_subcategories = Map.get(@subcategories, category, [])

      if subcategory in valid_subcategories do
        changeset
      else
        add_error(changeset, :subcategory, "invalid subcategory for #{category}")
      end
    else
      changeset
    end
  end

  @doc """
  Creates service from detected work patterns in images.
  """
  def create_from_detection(service_name, detected_category, tools_detected \\ []) do
    subcategory = guess_subcategory(service_name, detected_category)
    skill_level = guess_skill_level(tools_detected, detected_category)

    %{
      name: service_name,
      category: detected_category,
      subcategory: subcategory,
      skill_level_required: skill_level,
      tools_required: tools_detected,
      estimated_duration_minutes: estimate_duration(detected_category, subcategory),
      typical_cost_range: estimate_cost_range(detected_category, skill_level)
    }
  end

  @doc """
  Estimates total service cost including parts and labor.
  """
  def calculate_total_cost(service, parts_cost_cents \\ 0, shop_rate_cents \\ 9500) do
    duration_hours = (service.estimated_duration_minutes || 60) / 60.0
    labor_cost = round(duration_hours * shop_rate_cents)

    total_cost = parts_cost_cents + labor_cost

    %{
      parts_cost_cents: parts_cost_cents,
      labor_cost_cents: labor_cost,
      total_cost_cents: total_cost,
      estimated_hours: duration_hours,
      shop_rate_per_hour_cents: shop_rate_cents
    }
  end

  @doc """
  Determines if service can be performed by DIY vs professional.
  """
  def diy_feasible?(service) do
    service.skill_level_required in ["basic", "intermediate"] and
    Enum.all?(service.tools_required || [], &common_tool?/1)
  end

  @doc """
  Gets services by category with complexity scoring.
  """
  def services_by_complexity(category) do
    import Ecto.Query

    from s in __MODULE__,
      where: s.category == ^category,
      order_by: [
        asc: fragment(
          "CASE skill_level_required
           WHEN 'basic' THEN 1
           WHEN 'intermediate' THEN 2
           WHEN 'advanced' THEN 3
           WHEN 'professional' THEN 4
           END"
        ),
        asc: :estimated_duration_minutes
      ]
  end

  defp guess_subcategory(name, category) do
    name_lower = String.downcase(name)

    case category do
      "repair" ->
        cond do
          String.contains?(name_lower, ["engine", "motor"]) -> "engine_repair"
          String.contains?(name_lower, ["brake", "braking"]) -> "brake_repair"
          String.contains?(name_lower, ["electrical", "wiring", "battery"]) -> "electrical_repair"
          String.contains?(name_lower, ["suspension", "shock", "strut"]) -> "suspension_repair"
          String.contains?(name_lower, ["body", "dent", "collision"]) -> "bodywork_repair"
          String.contains?(name_lower, ["transmission", "trans"]) -> "transmission_repair"
          true -> "engine_repair"
        end

      "modification" ->
        cond do
          String.contains?(name_lower, ["performance", "turbo", "supercharger"]) -> "performance_upgrade"
          String.contains?(name_lower, ["exhaust", "muffler", "cat"]) -> "exhaust_modification"
          String.contains?(name_lower, ["intake", "air filter", "cold air"]) -> "intake_modification"
          String.contains?(name_lower, ["suspension", "coilover", "spring"]) -> "suspension_modification"
          String.contains?(name_lower, ["appearance", "cosmetic", "body kit"]) -> "appearance_modification"
          true -> "performance_upgrade"
        end

      "maintenance" ->
        cond do
          String.contains?(name_lower, ["oil", "oil change"]) -> "oil_change"
          String.contains?(name_lower, ["filter"]) -> "filter_replacement"
          String.contains?(name_lower, ["fluid", "coolant", "brake fluid"]) -> "fluid_service"
          true -> "scheduled_maintenance"
        end

      _ ->
        nil
    end
  end

  defp guess_skill_level(tools, category) do
    professional_tools = ["lift", "diagnostic_scanner", "welder", "alignment_equipment", "paint_gun"]
    advanced_tools = ["torque_wrench", "compression_tester", "multimeter", "oscilloscope"]

    has_professional_tools = Enum.any?(tools, &(&1 in professional_tools))
    has_advanced_tools = Enum.any?(tools, &(&1 in advanced_tools))

    cond do
      has_professional_tools or category in ["fabrication", "restoration"] -> "professional"
      has_advanced_tools or category == "diagnostic" -> "advanced"
      category in ["maintenance"] -> "intermediate"
      true -> "basic"
    end
  end

  defp estimate_duration(category, subcategory) do
    case {category, subcategory} do
      {"maintenance", "oil_change"} -> 30
      {"maintenance", "filter_replacement"} -> 45
      {"repair", "brake_repair"} -> 120
      {"repair", "engine_repair"} -> 480
      {"modification", "exhaust_modification"} -> 180
      {"modification", "intake_modification"} -> 90
      {"diagnostic", _} -> 60
      {"installation", _} -> 120
      {_, _} -> 180  # Default 3 hours
    end
  end

  defp estimate_cost_range(category, skill_level) do
    base_ranges = %{
      "maintenance" => %{"min_cents" => 5000, "max_cents" => 15000},
      "repair" => %{"min_cents" => 15000, "max_cents" => 80000},
      "modification" => %{"min_cents" => 20000, "max_cents" => 150000},
      "diagnostic" => %{"min_cents" => 8000, "max_cents" => 25000},
      "installation" => %{"min_cents" => 10000, "max_cents" => 50000}
    }

    base_range = Map.get(base_ranges, category, %{"min_cents" => 10000, "max_cents" => 50000})

    # Adjust for skill level
    multiplier = case skill_level do
      "professional" -> 1.5
      "advanced" -> 1.2
      "intermediate" -> 1.0
      "basic" -> 0.8
    end

    %{
      "min_cents" => round(base_range["min_cents"] * multiplier),
      "max_cents" => round(base_range["max_cents"] * multiplier),
      "currency" => "USD"
    }
  end

  defp common_tool?(tool) do
    common_tools = [
      "wrench", "socket_set", "screwdriver", "pliers", "jack", "jack_stands",
      "oil_drain_pan", "funnel", "basic_hand_tools", "tire_iron"
    ]

    tool in common_tools or String.contains?(String.downcase(tool), common_tools)
  end

  @doc """
  Generates corporate intelligence for service market analysis.
  """
  def generate_market_analysis(services) when is_list(services) do
    total_services = length(services)

    category_distribution = services
      |> Enum.group_by(& &1.category)
      |> Enum.map(fn {category, category_services} ->
        {category, length(category_services)}
      end)
      |> Enum.into(%{})

    skill_distribution = services
      |> Enum.group_by(& &1.skill_level_required)
      |> Enum.map(fn {skill, skill_services} ->
        {skill, length(skill_services)}
      end)
      |> Enum.into(%{})

    avg_duration = services
      |> Enum.map(& &1.estimated_duration_minutes || 180)
      |> Enum.sum()
      |> div(max(total_services, 1))

    %{
      total_services: total_services,
      category_distribution: category_distribution,
      skill_distribution: skill_distribution,
      avg_duration_minutes: avg_duration,
      professional_services_ratio: Map.get(skill_distribution, "professional", 0) / max(total_services, 1),
      diy_feasible_count: Enum.count(services, &diy_feasible?/1)
    }
  end
end