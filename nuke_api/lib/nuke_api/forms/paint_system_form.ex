defmodule NukeApi.Forms.PaintSystemForm do
  @moduledoc """
  Paint system documentation form for comprehensive restoration tracking.
  Supports everything from DIY garage jobs to professional shop work.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "paint_system_forms" do
    field :vehicle_id, :binary_id

    # Paint System Overview
    field :paint_type, :string           # "single_stage", "base_clear", "enamel"
    field :color_code, :string           # "GM WA8555", "Ford M6463A"
    field :color_name, :string           # "Summit White", "Oxford White"

    # Materials Documentation
    field :primer_brand, :string         # "PPG", "Sherwin Williams"
    field :primer_part_number, :string
    field :base_coat_brand, :string
    field :base_coat_part_number, :string
    field :clear_coat_brand, :string
    field :clear_coat_part_number, :string

    # Application Details
    field :surface_prep_method, :string  # "wet_sand", "dry_sand", "chemical_strip"
    field :primer_coats, :integer
    field :base_coats, :integer
    field :clear_coats, :integer
    field :application_method, :string   # "spray_gun", "roller", "aerosol"

    # Environment & Conditions
    field :paint_booth_used, :boolean
    field :temperature_range, :string    # "70-75F"
    field :humidity_level, :string       # "45-55%"
    field :cure_time_days, :integer

    # Labor Documentation
    field :total_labor_hours, :decimal
    field :owner_labor_hours, :decimal   # Your work
    field :hired_labor_hours, :decimal   # Co-worker/shop work
    field :hired_worker_name, :string
    field :shop_name, :string

    # Cost Breakdown
    field :material_cost, :decimal
    field :labor_cost, :decimal
    field :equipment_rental_cost, :decimal
    field :total_project_cost, :decimal

    # Quality Assessment
    field :finish_quality, :string       # "show_quality", "driver_quality", "work_truck"
    field :orange_peel_level, :string    # "minimal", "moderate", "heavy"
    field :color_match_quality, :string  # "perfect", "close", "noticeable_difference"

    # Issues & Solutions
    field :issues_encountered, {:array, :string}
    field :solutions_applied, {:array, :string}
    field :would_do_differently, :string

    # Documentation
    field :receipt_urls, {:array, :string}
    field :process_photos, {:array, :string}
    field :before_after_photos, {:array, :string}
    field :video_documentation, {:array, :string}

    # Verification
    field :professional_review, :boolean
    field :reviewer_name, :string
    field :review_notes, :string

    timestamps()
  end

  def changeset(form, attrs) do
    form
    |> cast(attrs, [
      :vehicle_id, :paint_type, :color_code, :color_name,
      :primer_brand, :primer_part_number, :base_coat_brand, :base_coat_part_number,
      :clear_coat_brand, :clear_coat_part_number,
      :surface_prep_method, :primer_coats, :base_coats, :clear_coats, :application_method,
      :paint_booth_used, :temperature_range, :humidity_level, :cure_time_days,
      :total_labor_hours, :owner_labor_hours, :hired_labor_hours,
      :hired_worker_name, :shop_name,
      :material_cost, :labor_cost, :equipment_rental_cost, :total_project_cost,
      :finish_quality, :orange_peel_level, :color_match_quality,
      :issues_encountered, :solutions_applied, :would_do_differently,
      :receipt_urls, :process_photos, :before_after_photos, :video_documentation,
      :professional_review, :reviewer_name, :review_notes
    ])
    |> validate_required([:vehicle_id, :paint_type])
    |> validate_inclusion(:paint_type, ["single_stage", "base_clear", "enamel", "other"])
    |> validate_inclusion(:finish_quality, ["show_quality", "driver_quality", "work_truck", "primer_only"])
    |> validate_number(:total_project_cost, greater_than_or_equal_to: 0)
  end

  @doc """
  Generate form template based on detected paint work.
  """
  def generate_template(vehicle_id, detected_work \\ %{}) do
    %__MODULE__{
      vehicle_id: vehicle_id,
      paint_type: detected_work["paint_type"] || "base_clear",
      application_method: detected_work["application_method"] || "spray_gun",
      # Pre-populate with common values to reduce data entry
      primer_coats: 2,
      base_coats: 3,
      clear_coats: 2,
      paint_booth_used: false  # Most DIY jobs
    }
  end

  @doc """
  Calculate completion percentage for this form.
  """
  def completion_percentage(form) do
    required_fields = [:paint_type, :color_code, :total_labor_hours, :material_cost]
    important_fields = [:primer_brand, :base_coat_brand, :clear_coat_brand, :finish_quality]
    optional_fields = [:hired_worker_name, :shop_name, :review_notes]

    total_fields = length(required_fields) + length(important_fields) + length(optional_fields)
    completed_fields =
      Enum.count(required_fields, &field_completed?(form, &1)) * 3 +  # Required worth 3x
      Enum.count(important_fields, &field_completed?(form, &1)) * 2 +  # Important worth 2x
      Enum.count(optional_fields, &field_completed?(form, &1))          # Optional worth 1x

    max_possible = length(required_fields) * 3 + length(important_fields) * 2 + length(optional_fields)

    Float.round(completed_fields / max_possible * 100, 1)
  end

  defp field_completed?(form, field) do
    value = Map.get(form, field)
    not is_nil(value) and value != "" and value != []
  end
end