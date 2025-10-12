defmodule NukeApi.Products.Product do
  @moduledoc """
  Schema for automotive products, parts, and components.

  Used for linking damage tags to specific products that were damaged,
  and modification tags to products that were installed or upgraded.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "products" do
    field :name, :string
    field :category, :string
    field :brand, :string
    field :model, :string
    field :part_number, :string
    field :description, :string
    field :price_cents, :integer
    field :currency, :string, default: "USD"
    field :availability, :string, default: "available"
    field :specifications, :map, default: %{}
    field :tags, {:array, :string}, default: []

    # Associations
    has_many :spatial_tags, NukeApi.Vehicles.SpatialTag

    timestamps(type: :utc_datetime)
  end

  @categories [
    "part",           # Mechanical parts, components
    "fluid",          # Oil, coolant, brake fluid, etc.
    "tool",           # Tools used for work
    "material",       # Consumables like sandpaper, primer
    "accessory",      # Add-on accessories
    "consumable",     # Items that get used up
    "hardware"        # Bolts, screws, gaskets
  ]

  @availability_statuses [
    "available",
    "discontinued",
    "back_ordered",
    "special_order",
    "out_of_stock"
  ]

  @required_fields [:name, :category]
  @optional_fields [:brand, :model, :part_number, :description, :price_cents,
                    :currency, :availability, :specifications, :tags]

  def changeset(product, attrs) do
    product
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:category, @categories)
    |> validate_inclusion(:availability, @availability_statuses)
    |> validate_number(:price_cents, greater_than_or_equal_to: 0)
    |> validate_length(:name, min: 2, max: 200)
    |> validate_length(:part_number, max: 100)
  end

  @doc """
  Creates a product entry from detected image tags and AI analysis.
  """
  def create_from_detection(brand, part_name, detected_info \\ %{}) do
    %{
      name: part_name,
      category: guess_category_from_name(part_name),
      brand: brand,
      model: Map.get(detected_info, :model),
      part_number: Map.get(detected_info, :part_number),
      description: Map.get(detected_info, :description),
      tags: extract_searchable_tags(part_name, brand, detected_info),
      specifications: Map.get(detected_info, :specifications, %{}),
      availability: "available"
    }
  end

  @doc """
  Searches products by various criteria including tags and specifications.
  """
  def search_query(query_string) do
    import Ecto.Query

    from p in __MODULE__,
      where:
        ilike(p.name, ^"%#{query_string}%") or
        ilike(p.brand, ^"%#{query_string}%") or
        ilike(p.model, ^"%#{query_string}%") or
        ilike(p.part_number, ^"%#{query_string}%") or
        ^query_string in p.tags
  end

  defp guess_category_from_name(name) do
    name_lower = String.downcase(name)

    cond do
      String.contains?(name_lower, ["oil", "fluid", "coolant", "brake fluid", "transmission"]) ->
        "fluid"
      String.contains?(name_lower, ["wrench", "socket", "tool", "scanner", "lift"]) ->
        "tool"
      String.contains?(name_lower, ["sandpaper", "primer", "paint", "compound", "wax"]) ->
        "material"
      String.contains?(name_lower, ["bolt", "screw", "gasket", "seal", "fastener"]) ->
        "hardware"
      String.contains?(name_lower, ["spoiler", "intake", "exhaust", "wheels", "tires"]) ->
        "accessory"
      true ->
        "part"
    end
  end

  defp extract_searchable_tags(name, brand, info) do
    base_tags = [
      String.downcase(name),
      brand && String.downcase(brand),
      info[:model] && String.downcase(info[:model])
    ]
    |> Enum.reject(&is_nil/1)

    # Add category-specific tags
    category_tags = case guess_category_from_name(name) do
      "fluid" -> ["maintenance", "service", "consumable"]
      "tool" -> ["equipment", "diagnostic", "repair"]
      "part" -> ["replacement", "oem", "aftermarket"]
      "accessory" -> ["modification", "upgrade", "appearance"]
      _ -> []
    end

    (base_tags ++ category_tags)
    |> Enum.uniq()
    |> Enum.take(10) # Limit to 10 tags for performance
  end

  @doc """
  Calculates estimated replacement cost based on product data and market factors.
  """
  def estimate_replacement_cost(product, market_multiplier \\ 1.0) do
    base_cost = product.price_cents || 0

    # Apply market factors
    estimated_cost = base_cost * market_multiplier

    # Add labor estimation for installation
    labor_factor = case product.category do
      "fluid" -> 1.5  # Simple fluid change
      "part" -> 2.5   # Part replacement requires labor
      "accessory" -> 2.0 # Installation labor
      _ -> 1.0
    end

    round(estimated_cost * labor_factor)
  end

  @doc """
  Determines compatibility with vehicle based on specifications.
  """
  def compatible_with_vehicle?(product, vehicle) do
    specs = product.specifications || %{}

    # Check make compatibility
    compatible_makes = specs["compatible_makes"] || []
    if !Enum.empty?(compatible_makes) and vehicle.make not in compatible_makes do
      false
    else
      # Check year range
      min_year = specs["min_year"]
      max_year = specs["max_year"]

      vehicle_year = vehicle.year

      cond do
        min_year && vehicle_year < min_year -> false
        max_year && vehicle_year > max_year -> false
        true -> true
      end
    end
  end
end