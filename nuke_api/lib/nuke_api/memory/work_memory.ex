defmodule NukeApi.Memory.WorkMemory do
  @moduledoc """
  Capture fragmented, incomplete memories of vehicle work.

  This is NOT structured forms - it's a flexible system for recording
  whatever partial information the user remembers about work they did.

  Examples:
  - "Installed headlights, LED upgrade, did wiring myself"
  - "Painted truck, used Sherwin Williams, worked with John"
  - "Chinese bolts suck, want to upgrade to better quality"
  - "New grill, reproduction, forgot the brand"
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "work_memories" do
    field :vehicle_id, :binary_id

    # Freeform user input - the actual memory
    field :memory_text, :string           # "Installed LED headlights, did wiring"
    field :work_category, :string         # "lighting", "paint", "hardware" (optional)
    field :confidence_level, :string      # "certain", "pretty_sure", "maybe"

    # Whatever partial data they remember
    field :brands_mentioned, {:array, :string}    # ["Sherwin Williams", "Chinese"]
    field :parts_mentioned, {:array, :string}     # ["headlights", "bolts", "grill"]
    field :people_involved, {:array, :string}     # ["John", "myself"]
    field :tools_used, {:array, :string}          # ["wiring", "spray gun"]
    field :locations, {:array, :string}           # ["garage", "driveway"]

    # Rough estimates - whatever they remember
    field :time_period, :string           # "last summer", "2023", "few months ago"
    field :approximate_cost, :decimal     # Rough guess
    field :labor_split, :string           # "mostly me", "50/50", "hired it out"

    # Quality/satisfaction notes
    field :quality_notes, :string         # "hate the quality", "looks good"
    field :issues_encountered, :string    # "wiring was tricky"
    field :future_plans, :string          # "want to upgrade bolts"

    # Link to evidence they remember exists
    field :has_photos, :boolean           # "I have photos of this"
    field :has_receipts, :boolean         # "I kept the receipt"
    field :photo_descriptions, {:array, :string}  # ["before shots", "during install"]

    # System will try to link this to actual data later
    field :linked_images, {:array, :binary_id}    # Auto-populated
    field :linked_timeline_events, {:array, :binary_id}  # Auto-populated
    field :verification_score, :integer   # How well this matches actual evidence

    timestamps()
  end

  def changeset(memory, attrs) do
    memory
    |> cast(attrs, [
      :vehicle_id, :memory_text, :work_category, :confidence_level,
      :brands_mentioned, :parts_mentioned, :people_involved, :tools_used, :locations,
      :time_period, :approximate_cost, :labor_split,
      :quality_notes, :issues_encountered, :future_plans,
      :has_photos, :has_receipts, :photo_descriptions
    ])
    |> validate_required([:vehicle_id, :memory_text])
    |> validate_inclusion(:confidence_level, ["certain", "pretty_sure", "maybe", "unclear"])
    |> extract_structured_data_from_text()
  end

  @doc """
  Extract structured data from freeform memory text using simple pattern matching.
  """
  defp extract_structured_data_from_text(changeset) do
    memory_text = get_field(changeset, :memory_text) || ""

    # Extract mentions of brands, parts, people, etc.
    brands = extract_brands(memory_text)
    parts = extract_parts(memory_text)
    people = extract_people(memory_text)
    tools = extract_tools(memory_text)

    changeset
    |> put_change(:brands_mentioned, merge_arrays(get_field(changeset, :brands_mentioned), brands))
    |> put_change(:parts_mentioned, merge_arrays(get_field(changeset, :parts_mentioned), parts))
    |> put_change(:people_involved, merge_arrays(get_field(changeset, :people_involved), people))
    |> put_change(:tools_used, merge_arrays(get_field(changeset, :tools_used), tools))
    |> infer_work_category(memory_text)
  end

  defp extract_brands(text) do
    # Simple brand detection - can be improved over time
    brand_patterns = [
      ~r/sherwin\s+williams/i,
      ~r/ppg/i,
      ~r/chinese/i,
      ~r/oem/i,
      ~r/arp/i,
      ~r/led/i
    ]

    brand_names = [
      "Sherwin Williams",
      "PPG",
      "Chinese",
      "OEM",
      "ARP",
      "LED"
    ]

    Enum.zip(brand_patterns, brand_names)
    |> Enum.filter(fn {pattern, _name} -> Regex.match?(pattern, text) end)
    |> Enum.map(fn {_pattern, name} -> name end)
  end

  defp extract_parts(text) do
    part_patterns = %{
      ~r/headlight/i => "headlights",
      ~r/paint/i => "paint",
      ~r/bolt/i => "bolts",
      ~r/grill/i => "grill",
      ~r/mirror/i => "mirrors",
      ~r/trim/i => "trim",
      ~r/fender/i => "fenders",
      ~r/wheel/i => "wheels"
    }

    part_patterns
    |> Enum.filter(fn {pattern, _name} -> Regex.match?(pattern, text) end)
    |> Enum.map(fn {_pattern, name} -> name end)
  end

  defp extract_people(text) do
    # Look for common name patterns and work relationships
    people = []

    # Extract names that follow patterns like "worked with X"
    case Regex.run(~r/worked?\s+with\s+(\w+)/i, text) do
      [_full, name] -> [name | people]
      _ -> people
    end
    |> then(fn people ->
      # Look for "myself", "I did", etc.
      if Regex.match?(~r/(myself|I\s+did|did.*myself)/i, text) do
        ["myself" | people]
      else
        people
      end
    end)
  end

  defp extract_tools(text) do
    tool_patterns = %{
      ~r/wiring/i => "wiring",
      ~r/spray/i => "spray gun",
      ~r/sand/i => "sanding",
      ~r/cut/i => "cutting"
    }

    tool_patterns
    |> Enum.filter(fn {pattern, _name} -> Regex.match?(pattern, text) end)
    |> Enum.map(fn {_pattern, name} -> name end)
  end

  defp infer_work_category(changeset, text) do
    categories = %{
      "lighting" => ~r/(headlight|led|light)/i,
      "paint" => ~r/(paint|color|spray|primer)/i,
      "hardware" => ~r/(bolt|screw|fastener)/i,
      "body" => ~r/(fender|grill|trim|panel)/i,
      "engine" => ~r/(engine|motor)/i
    }

    category = Enum.find_value(categories, fn {cat, pattern} ->
      if Regex.match?(pattern, text), do: cat
    end)

    if category do
      put_change(changeset, :work_category, category)
    else
      changeset
    end
  end

  defp merge_arrays(existing, new) do
    (existing || [])
    |> Kernel.++(new || [])
    |> Enum.uniq()
    |> Enum.reject(&(&1 == "" or is_nil(&1)))
  end

  @doc """
  Create a memory entry from freeform text input.
  """
  def create_memory(vehicle_id, memory_text, opts \\ []) do
    attrs = %{
      vehicle_id: vehicle_id,
      memory_text: memory_text,
      confidence_level: opts[:confidence_level] || "pretty_sure",
      has_photos: opts[:has_photos] || false,
      has_receipts: opts[:has_receipts] || false
    }

    %__MODULE__{}
    |> changeset(attrs)
  end
end