defmodule NukeApi.Vehicles.SpatialTag do
  @moduledoc """
  Enhanced spatial tag schema with product, service, technician, and shop associations.

  Extends the original image tag concept to support:
  - Product links for damage/modification tags
  - Technician and shop associations for professional service tracking
  - EXIF-based automated location tagging
  - Comprehensive modification tracking (product + service + shop + technician)
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "spatial_tags" do
    # Original spatial tag fields
    field :x_position, :float
    field :y_position, :float
    field :tag_type, :string
    field :text, :string
    field :verification_status, :string, default: "pending"
    field :trust_score, :integer, default: 10
    field :created_by, :string
    field :verified_by, :string
    field :verified_at, :utc_datetime
    field :metadata, :map, default: %{}

    # Enhanced associations
    belongs_to :image, NukeApi.Vehicles.Image
    belongs_to :product, NukeApi.Products.Product
    belongs_to :service, NukeApi.Services.Service
    belongs_to :technician, NukeApi.Services.Technician
    belongs_to :shop, NukeApi.Services.Shop

    # Product relationship fields
    field :product_relation, :string # "damaged", "replaced_with", "upgraded_to", "requires"

    # Service tracking fields
    field :service_status, :string # "needed", "in_progress", "completed", "failed"
    field :service_date, :utc_datetime
    field :service_cost_cents, :integer
    field :service_warranty_expires, :utc_datetime

    # EXIF and automated tagging
    field :source_type, :string, default: "manual" # "manual", "exif", "ai_detected", "imported"
    field :exif_data, :map, default: %{}
    field :gps_coordinates, :map, default: %{}
    field :automated_confidence, :float # 0.0 to 1.0
    field :needs_human_verification, :boolean, default: false

    # Enhanced metadata
    field :condition_before, :string
    field :condition_after, :string
    field :severity_level, :string # "minor", "moderate", "severe", "critical"
    field :estimated_cost_cents, :integer
    field :insurance_claim_number, :string
    field :work_order_number, :string

    # Time tracking
    field :work_started_at, :utc_datetime
    field :work_completed_at, :utc_datetime
    field :estimated_completion, :utc_datetime

    timestamps(type: :utc_datetime)
  end

  @tag_types [
    "product", "damage", "location", "modification", "brand", "part", "tool",
    "fluid", "service", "repair", "inspection", "diagnostic"
  ]

  @verification_statuses [
    "pending", "verified", "peer_verified", "disputed", "rejected", "auto_verified"
  ]

  @product_relations [
    "damaged", "replaced_with", "upgraded_to", "requires", "installed", "removed"
  ]

  @service_statuses [
    "needed", "quoted", "approved", "in_progress", "completed", "failed", "cancelled"
  ]

  @source_types [
    "manual", "exif", "ai_detected", "imported", "auto_generated"
  ]

  @severity_levels [
    "minor", "moderate", "severe", "critical"
  ]

  @required_fields [:image_id, :x_position, :y_position, :tag_type, :text]
  @optional_fields [
    :verification_status, :trust_score, :created_by, :verified_by, :verified_at,
    :metadata, :product_id, :service_id, :technician_id, :shop_id,
    :product_relation, :service_status, :service_date, :service_cost_cents,
    :service_warranty_expires, :source_type, :exif_data, :gps_coordinates,
    :automated_confidence, :needs_human_verification, :condition_before,
    :condition_after, :severity_level, :estimated_cost_cents,
    :insurance_claim_number, :work_order_number, :work_started_at,
    :work_completed_at, :estimated_completion
  ]

  def changeset(spatial_tag, attrs) do
    spatial_tag
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:tag_type, @tag_types)
    |> validate_inclusion(:verification_status, @verification_statuses)
    |> validate_inclusion(:product_relation, @product_relations)
    |> validate_inclusion(:service_status, @service_statuses)
    |> validate_inclusion(:source_type, @source_types)
    |> validate_inclusion(:severity_level, @severity_levels)
    |> validate_number(:x_position, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_number(:y_position, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_number(:trust_score, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_number(:automated_confidence, greater_than_or_equal_to: 0.0, less_than_or_equal_to: 1.0)
    |> validate_number(:service_cost_cents, greater_than_or_equal_to: 0)
    |> validate_number(:estimated_cost_cents, greater_than_or_equal_to: 0)
    |> validate_length(:text, min: 1, max: 500)
    |> foreign_key_constraint(:image_id)
    |> foreign_key_constraint(:product_id)
    |> foreign_key_constraint(:service_id)
    |> foreign_key_constraint(:technician_id)
    |> foreign_key_constraint(:shop_id)
    |> validate_damage_tag_requirements()
    |> validate_modification_requirements()
    |> validate_service_consistency()
  end

  @doc """
  Creates a damage tag with product and severity information.
  """
  def create_damage_tag(attrs) do
    attrs
    |> Map.put("tag_type", "damage")
    |> Map.put("source_type", Map.get(attrs, "source_type", "manual"))
    |> then(&changeset(%__MODULE__{}, &1))
  end

  @doc """
  Creates a modification tag with complete service tracking.
  """
  def create_modification_tag(attrs) do
    attrs
    |> Map.put("tag_type", "modification")
    |> Map.put("service_status", Map.get(attrs, "service_status", "needed"))
    |> then(&changeset(%__MODULE__{}, &1))
  end

  @doc """
  Creates an automated tag from EXIF data.
  """
  def create_from_exif(image_id, exif_data, detected_content) do
    gps_coords = extract_gps_coordinates(exif_data)

    %{
      image_id: image_id,
      x_position: Map.get(detected_content, :x_position, 50.0),
      y_position: Map.get(detected_content, :y_position, 50.0),
      tag_type: "location",
      text: Map.get(detected_content, :text, "Auto-detected location"),
      source_type: "exif",
      exif_data: exif_data,
      gps_coordinates: gps_coords,
      automated_confidence: Map.get(detected_content, :confidence, 0.8),
      needs_human_verification: Map.get(detected_content, :confidence, 0.8) < 0.9,
      trust_score: round(Map.get(detected_content, :confidence, 0.8) * 100)
    }
    |> then(&changeset(%__MODULE__{}, &1))
  end

  @doc """
  Validates that damage tags have appropriate product associations and severity.
  """
  defp validate_damage_tag_requirements(changeset) do
    if get_field(changeset, :tag_type) == "damage" do
      changeset
      |> validate_damage_product_relation()
      |> validate_damage_severity()
    else
      changeset
    end
  end

  @doc """
  Validates that modification tags have complete service information.
  """
  defp validate_modification_requirements(changeset) do
    if get_field(changeset, :tag_type) == "modification" do
      changeset
      |> validate_modification_completeness()
    else
      changeset
    end
  end

  @doc """
  Validates consistency between service fields.
  """
  defp validate_service_consistency(changeset) do
    service_id = get_field(changeset, :service_id)
    service_status = get_field(changeset, :service_status)
    service_date = get_field(changeset, :service_date)

    cond do
      service_id && !service_status ->
        add_error(changeset, :service_status, "required when service is specified")

      service_status in ["completed", "failed"] && !service_date ->
        add_error(changeset, :service_date, "required when service is completed or failed")

      true ->
        changeset
    end
  end

  defp validate_damage_product_relation(changeset) do
    product_id = get_field(changeset, :product_id)
    product_relation = get_field(changeset, :product_relation)

    if product_id && !product_relation do
      add_error(changeset, :product_relation, "required when product is specified for damage")
    else
      changeset
    end
  end

  defp validate_damage_severity(changeset) do
    severity = get_field(changeset, :severity_level)
    estimated_cost = get_field(changeset, :estimated_cost_cents)

    # For severe/critical damage, we expect cost estimation
    if severity in ["severe", "critical"] && !estimated_cost do
      add_error(changeset, :estimated_cost_cents, "recommended for severe or critical damage")
    else
      changeset
    end
  end

  defp validate_modification_completeness(changeset) do
    # Modifications should ideally have service and product information
    product_id = get_field(changeset, :product_id)
    service_id = get_field(changeset, :service_id)

    cond do
      !product_id && !service_id ->
        add_error(changeset, :base, "modification should specify either product installed or service performed")

      true ->
        changeset
    end
  end

  defp extract_gps_coordinates(exif_data) do
    with {:ok, lat} <- Map.fetch(exif_data, "GPSLatitude"),
         {:ok, lng} <- Map.fetch(exif_data, "GPSLongitude"),
         {:ok, lat_ref} <- Map.fetch(exif_data, "GPSLatitudeRef"),
         {:ok, lng_ref} <- Map.fetch(exif_data, "GPSLongitudeRef") do

      lat_decimal = convert_gps_coordinate(lat, lat_ref)
      lng_decimal = convert_gps_coordinate(lng, lng_ref)

      %{
        "latitude" => lat_decimal,
        "longitude" => lng_decimal,
        "accuracy" => Map.get(exif_data, "GPSAccuracy", 10)
      }
    else
      _ -> %{}
    end
  end

  defp convert_gps_coordinate(coordinate, reference) when is_binary(coordinate) do
    # Parse DMS format: "40/1,26/1,46.302/1000"
    parts = String.split(coordinate, ",")

    case parts do
      [degrees, minutes, seconds] ->
        deg = parse_fraction(degrees)
        min = parse_fraction(minutes)
        sec = parse_fraction(seconds)

        decimal = deg + (min / 60) + (sec / 3600)

        if reference in ["S", "W"] do
          -decimal
        else
          decimal
        end

      _ ->
        0.0
    end
  end

  defp convert_gps_coordinate(coordinate, _reference) when is_float(coordinate) do
    coordinate
  end

  defp parse_fraction(fraction_str) do
    case String.split(fraction_str, "/") do
      [numerator, denominator] ->
        String.to_float(numerator) / String.to_float(denominator)

      [number] ->
        String.to_float(number)

      _ ->
        0.0
    end
  end

  @doc """
  Generates comprehensive analytics for corporate data harvesting.
  """
  def generate_tag_analytics(tags) when is_list(tags) do
    total_tags = length(tags)

    %{
      total_tags: total_tags,
      tag_type_distribution: analyze_tag_types(tags),
      damage_analysis: analyze_damage_tags(tags),
      modification_analysis: analyze_modification_tags(tags),
      service_analysis: analyze_service_tags(tags),
      automation_metrics: analyze_automation_metrics(tags),
      professional_involvement: analyze_professional_involvement(tags),
      cost_analysis: analyze_cost_patterns(tags)
    }
  end

  defp analyze_tag_types(tags) do
    tags
    |> Enum.group_by(& &1.tag_type)
    |> Enum.map(fn {type, type_tags} -> {type, length(type_tags)} end)
    |> Enum.into(%{})
  end

  defp analyze_damage_tags(tags) do
    damage_tags = Enum.filter(tags, &(&1.tag_type == "damage"))

    %{
      total_damage_tags: length(damage_tags),
      severity_distribution: damage_tags
        |> Enum.group_by(& &1.severity_level)
        |> Enum.map(fn {sev, sev_tags} -> {sev, length(sev_tags)} end)
        |> Enum.into(%{}),
      avg_estimated_cost: calculate_avg_cost(damage_tags, :estimated_cost_cents),
      insurance_claims: Enum.count(damage_tags, &(&1.insurance_claim_number != nil))
    }
  end

  defp analyze_modification_tags(tags) do
    mod_tags = Enum.filter(tags, &(&1.tag_type == "modification"))

    %{
      total_modifications: length(mod_tags),
      service_status_distribution: mod_tags
        |> Enum.group_by(& &1.service_status)
        |> Enum.map(fn {status, status_tags} -> {status, length(status_tags)} end)
        |> Enum.into(%{}),
      avg_service_cost: calculate_avg_cost(mod_tags, :service_cost_cents),
      professional_installation_rate: Enum.count(mod_tags, &(&1.technician_id != nil)) / max(length(mod_tags), 1)
    }
  end

  defp analyze_service_tags(tags) do
    service_tags = Enum.filter(tags, &(&1.service_id != nil))

    %{
      total_service_tags: length(service_tags),
      completion_rate: Enum.count(service_tags, &(&1.service_status == "completed")) / max(length(service_tags), 1),
      avg_service_duration: calculate_avg_service_duration(service_tags),
      shop_involvement_rate: Enum.count(service_tags, &(&1.shop_id != nil)) / max(length(service_tags), 1)
    }
  end

  defp analyze_automation_metrics(tags) do
    automated_tags = Enum.filter(tags, &(&1.source_type != "manual"))

    %{
      automation_rate: length(automated_tags) / max(length(tags), 1),
      avg_automated_confidence: automated_tags
        |> Enum.map(&(&1.automated_confidence || 0.0))
        |> Enum.sum()
        |> Kernel./(max(length(automated_tags), 1)),
      verification_needed_count: Enum.count(tags, &(&1.needs_human_verification == true))
    }
  end

  defp analyze_professional_involvement(tags) do
    professional_tags = Enum.filter(tags, &(&1.technician_id != nil or &1.shop_id != nil))

    %{
      professional_involvement_rate: length(professional_tags) / max(length(tags), 1),
      unique_technicians: tags |> Enum.map(& &1.technician_id) |> Enum.reject(&is_nil/1) |> Enum.uniq() |> length(),
      unique_shops: tags |> Enum.map(& &1.shop_id) |> Enum.reject(&is_nil/1) |> Enum.uniq() |> length()
    }
  end

  defp analyze_cost_patterns(tags) do
    cost_tags = Enum.filter(tags, &(&1.service_cost_cents != nil or &1.estimated_cost_cents != nil))

    %{
      cost_tracking_rate: length(cost_tags) / max(length(tags), 1),
      total_tracked_costs: cost_tags |> Enum.map(&((&1.service_cost_cents || 0) + (&1.estimated_cost_cents || 0))) |> Enum.sum(),
      avg_cost_per_tag: calculate_avg_total_cost(cost_tags)
    }
  end

  defp calculate_avg_cost(tags, cost_field) do
    costs = tags |> Enum.map(&Map.get(&1, cost_field)) |> Enum.reject(&is_nil/1)
    if Enum.empty?(costs), do: 0, else: Enum.sum(costs) / length(costs)
  end

  defp calculate_avg_service_duration(tags) do
    durations = tags
      |> Enum.filter(&(&1.work_started_at && &1.work_completed_at))
      |> Enum.map(fn tag ->
        DateTime.diff(tag.work_completed_at, tag.work_started_at, :minute)
      end)

    if Enum.empty?(durations), do: 0, else: Enum.sum(durations) / length(durations)
  end

  defp calculate_avg_total_cost(tags) do
    total_costs = tags
      |> Enum.map(&((&1.service_cost_cents || 0) + (&1.estimated_cost_cents || 0)))
      |> Enum.reject(&(&1 == 0))

    if Enum.empty?(total_costs), do: 0, else: Enum.sum(total_costs) / length(total_costs)
  end

  # Getters for constants
  def tag_types, do: @tag_types
  def verification_statuses, do: @verification_statuses
  def product_relations, do: @product_relations
  def service_statuses, do: @service_statuses
  def source_types, do: @source_types
  def severity_levels, do: @severity_levels
end