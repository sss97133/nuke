defmodule NukeApiWeb.EnhancedTaggingController do
  use NukeApiWeb, :controller

  alias NukeApi.Vehicles.SpatialTag
  alias NukeApi.Products
  alias NukeApi.Services
  alias NukeApi.Media.ExifProcessor
  alias NukeApi.Repo

  @doc """
  Create a damage tag with product and service associations.
  """
  def create_damage_tag(conn, %{"tag" => tag_params}) do
    case SpatialTag.create_damage_tag(tag_params) do
      {:ok, tag} ->
        conn
        |> put_status(:created)
        |> json(%{
          status: "success",
          data: load_tag_with_associations(tag)
        })

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{
          status: "error",
          errors: translate_errors(changeset)
        })
    end
  end

  @doc """
  Create a modification tag with complete service tracking.
  """
  def create_modification_tag(conn, %{"tag" => tag_params}) do
    case SpatialTag.create_modification_tag(tag_params) do
      {:ok, tag} ->
        conn
        |> put_status(:created)
        |> json(%{
          status: "success",
          data: load_tag_with_associations(tag)
        })

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{
          status: "error",
          errors: translate_errors(changeset)
        })
    end
  end

  @doc """
  Process EXIF data and create automated location tags.
  """
  def process_exif_data(conn, %{"image_id" => image_id, "exif_data" => exif_data}) do
    result = ExifProcessor.process_image_exif(image_id, exif_data)

    conn
    |> json(%{
      status: "success",
      data: result
    })
  end

  @doc """
  Create a comprehensive modification tag with product, service, shop, and technician.
  """
  def create_comprehensive_modification(conn, %{"modification" => mod_params}) do
    # Extract individual components
    product_attrs = Map.get(mod_params, "product", %{})
    service_attrs = Map.get(mod_params, "service", %{})
    tag_attrs = Map.get(mod_params, "tag", %{})

    # Start transaction for comprehensive creation
    Repo.transaction(fn ->
      # Create or find product if specified
      product_id = case create_or_find_product(product_attrs) do
        {:ok, product} -> product.id
        _ -> nil
      end

      # Create or find service if specified
      service_id = case create_or_find_service(service_attrs) do
        {:ok, service} -> service.id
        _ -> nil
      end

      # Add associations to tag
      enhanced_tag_attrs = tag_attrs
        |> Map.put("product_id", product_id)
        |> Map.put("service_id", service_id)
        |> Map.put("technician_id", Map.get(mod_params, "technician_id"))
        |> Map.put("shop_id", Map.get(mod_params, "shop_id"))
        |> Map.put("service_status", Map.get(mod_params, "service_status", "needed"))

      # Create the modification tag
      case SpatialTag.create_modification_tag(enhanced_tag_attrs) do
        {:ok, tag} ->
          load_tag_with_associations(tag)

        {:error, changeset} ->
          Repo.rollback(changeset)
      end
    end)
    |> case do
      {:ok, tag_data} ->
        conn
        |> put_status(:created)
        |> json(%{
          status: "success",
          data: tag_data
        })

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{
          status: "error",
          errors: translate_errors(changeset)
        })
    end
  end

  @doc """
  Update service status for a modification tag.
  """
  def update_service_status(conn, %{"id" => tag_id, "status" => status_params}) do
    with {:ok, tag} <- get_spatial_tag(tag_id),
         {:ok, updated_tag} <- update_tag_service_status(tag, status_params) do
      json(conn, %{
        status: "success",
        data: load_tag_with_associations(updated_tag)
      })
    else
      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Tag not found"})

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{
          status: "error",
          errors: translate_errors(changeset)
        })
    end
  end

  @doc """
  Get comprehensive analytics for enhanced tagging system.
  """
  def get_analytics(conn, _params) do
    tags = Repo.all(SpatialTag) |> Repo.preload([:product, :service, :technician, :shop])

    analytics = SpatialTag.generate_tag_analytics(tags)

    json(conn, %{
      status: "success",
      data: analytics
    })
  end

  @doc """
  Get professional service network analytics.
  """
  def get_service_network_analytics(conn, _params) do
    analytics = Services.generate_industry_analytics()

    json(conn, %{
      status: "success",
      data: analytics
    })
  end

  @doc """
  Get product market analytics.
  """
  def get_product_analytics(conn, _params) do
    analytics = Products.generate_product_analytics()

    json(conn, %{
      status: "success",
      data: analytics
    })
  end

  @doc """
  Analyze EXIF patterns for corporate intelligence.
  """
  def analyze_exif_patterns(conn, %{"exif_data_list" => exif_data_list}) do
    intelligence = ExifProcessor.generate_exif_intelligence(exif_data_list)

    json(conn, %{
      status: "success",
      data: intelligence
    })
  end

  @doc """
  Get damage assessment with product recommendations.
  """
  def assess_damage(conn, %{"tag_id" => tag_id}) do
    with {:ok, tag} <- get_spatial_tag(tag_id),
         true <- tag.tag_type == "damage" do

      # Get associated product if available
      product = if tag.product_id, do: Products.get_product(tag.product_id), else: nil

      # Get vehicle information
      image = Repo.get(NukeApi.Vehicles.Image, tag.image_id) |> Repo.preload([:vehicle])
      vehicle = image && image.vehicle

      # Generate recommendations
      recommendations = if product && vehicle do
        Products.get_replacement_recommendations(product, vehicle)
      else
        []
      end

      # Calculate estimated costs
      cost_estimate = if product do
        Products.Product.estimate_replacement_cost(product)
      else
        0
      end

      assessment = %{
        damage_tag: load_tag_with_associations(tag),
        damaged_product: product,
        vehicle_info: vehicle && %{
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year
        },
        replacement_recommendations: recommendations,
        cost_estimate: %{
          parts_cost_cents: cost_estimate,
          estimated_total_cents: cost_estimate * 2, # Rough labor multiplier
          severity_multiplier: severity_cost_multiplier(tag.severity_level)
        },
        service_recommendations: generate_service_recommendations(tag)
      }

      json(conn, %{
        status: "success",
        data: assessment
      })
    else
      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Damage tag not found"})

      false ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "Tag is not a damage tag"})
    end
  end

  @doc """
  Track modification progress through service lifecycle.
  """
  def track_modification_progress(conn, %{"tag_id" => tag_id}) do
    with {:ok, tag} <- get_spatial_tag(tag_id),
         true <- tag.tag_type == "modification" do

      progress = %{
        modification_tag: load_tag_with_associations(tag),
        service_status: tag.service_status,
        progress_percentage: calculate_progress_percentage(tag),
        timeline: generate_service_timeline(tag),
        cost_tracking: %{
          estimated_cost: tag.estimated_cost_cents,
          actual_cost: tag.service_cost_cents,
          cost_variance: calculate_cost_variance(tag)
        },
        quality_indicators: %{
          technician_score: tag.technician && Services.Technician.calculate_professional_score(tag.technician),
          shop_score: tag.shop && Services.Shop.calculate_business_score(tag.shop),
          warranty_period: tag.service_warranty_expires
        }
      }

      json(conn, %{
        status: "success",
        data: progress
      })
    else
      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Modification tag not found"})

      false ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "Tag is not a modification tag"})
    end
  end

  @doc """
  Generate corporate intelligence report for B2B targeting.
  """
  def generate_corporate_intelligence(conn, _params) do
    tags = Repo.all(SpatialTag) |> Repo.preload([:product, :service, :technician, :shop])

    intelligence = %{
      tagging_analytics: SpatialTag.generate_tag_analytics(tags),
      service_network: Services.generate_industry_analytics(),
      product_market: Products.generate_product_analytics(),
      professional_targeting: generate_targeting_intelligence(tags),
      market_opportunities: identify_market_opportunities(tags)
    }

    json(conn, %{
      status: "success",
      data: intelligence
    })
  end

  ## Private Helper Functions

  defp get_spatial_tag(id) do
    case Repo.get(SpatialTag, id) do
      nil -> {:error, :not_found}
      tag -> {:ok, Repo.preload(tag, [:product, :service, :technician, :shop])}
    end
  end

  defp load_tag_with_associations(tag) do
    tag
    |> Repo.preload([:product, :service, :technician, :shop])
    |> Map.take([:id, :x_position, :y_position, :tag_type, :text, :verification_status,
                 :trust_score, :product, :service, :technician, :shop, :service_status,
                 :severity_level, :estimated_cost_cents, :service_cost_cents, :gps_coordinates])
  end

  defp create_or_find_product(%{} = product_attrs) when map_size(product_attrs) > 0 do
    brand = Map.get(product_attrs, "brand")
    name = Map.get(product_attrs, "name")

    if brand && name do
      Products.create_or_find_from_detection(brand, name, product_attrs)
    else
      {:error, "Insufficient product information"}
    end
  end

  defp create_or_find_product(_), do: {:ok, nil}

  defp create_or_find_service(%{} = service_attrs) when map_size(service_attrs) > 0 do
    name = Map.get(service_attrs, "name")
    category = Map.get(service_attrs, "category")
    tools = Map.get(service_attrs, "tools_required", [])

    if name && category do
      Services.create_or_find_from_detection(name, category, tools)
    else
      {:error, "Insufficient service information"}
    end
  end

  defp create_or_find_service(_), do: {:ok, nil}

  defp update_tag_service_status(tag, status_params) do
    update_attrs = %{
      service_status: Map.get(status_params, "status"),
      service_date: Map.get(status_params, "service_date"),
      service_cost_cents: Map.get(status_params, "cost_cents"),
      work_started_at: Map.get(status_params, "started_at"),
      work_completed_at: Map.get(status_params, "completed_at"),
      condition_after: Map.get(status_params, "condition_after"),
      service_warranty_expires: Map.get(status_params, "warranty_expires")
    }
    |> Enum.reject(fn {_k, v} -> is_nil(v) end)
    |> Enum.into(%{})

    tag
    |> SpatialTag.changeset(update_attrs)
    |> Repo.update()
  end

  defp severity_cost_multiplier(severity) do
    case severity do
      "critical" -> 3.0
      "severe" -> 2.0
      "moderate" -> 1.5
      "minor" -> 1.0
      _ -> 1.2
    end
  end

  defp generate_service_recommendations(damage_tag) do
    case damage_tag.severity_level do
      "critical" -> [
        %{service: "immediate_inspection", priority: "urgent"},
        %{service: "safety_assessment", priority: "urgent"},
        %{service: "emergency_repair", priority: "high"}
      ]
      "severe" -> [
        %{service: "professional_diagnosis", priority: "high"},
        %{service: "repair_estimate", priority: "high"}
      ]
      "moderate" -> [
        %{service: "diagnostic_check", priority: "medium"},
        %{service: "preventive_maintenance", priority: "medium"}
      ]
      _ -> [
        %{service: "routine_inspection", priority: "low"}
      ]
    end
  end

  defp calculate_progress_percentage(tag) do
    case tag.service_status do
      "needed" -> 0
      "quoted" -> 10
      "approved" -> 20
      "in_progress" -> 60
      "completed" -> 100
      "failed" -> 0
      "cancelled" -> 0
      _ -> 0
    end
  end

  defp generate_service_timeline(tag) do
    events = []

    events = if tag.inserted_at do
      [%{event: "modification_tagged", date: tag.inserted_at, status: "completed"} | events]
    else
      events
    end

    events = if tag.work_started_at do
      [%{event: "work_started", date: tag.work_started_at, status: "completed"} | events]
    else
      events
    end

    events = if tag.work_completed_at do
      [%{event: "work_completed", date: tag.work_completed_at, status: "completed"} | events]
    else
      events
    end

    events = if tag.estimated_completion do
      [%{event: "estimated_completion", date: tag.estimated_completion, status: "projected"} | events]
    else
      events
    end

    Enum.sort_by(events, & &1.date, DateTime)
  end

  defp calculate_cost_variance(tag) do
    estimated = tag.estimated_cost_cents || 0
    actual = tag.service_cost_cents || 0

    if estimated > 0 do
      variance_pct = ((actual - estimated) / estimated) * 100
      %{
        variance_cents: actual - estimated,
        variance_percentage: variance_pct,
        under_budget: variance_pct < 0,
        variance_category: cond do
          abs(variance_pct) <= 10 -> "on_budget"
          variance_pct > 0 -> "over_budget"
          true -> "under_budget"
        end
      }
    else
      %{variance_cents: 0, variance_percentage: 0}
    end
  end

  defp generate_targeting_intelligence(tags) do
    professional_tags = Enum.filter(tags, &(&1.technician_id || &1.shop_id))

    %{
      professional_involvement_rate: length(professional_tags) / max(length(tags), 1),
      high_value_modifications: analyze_high_value_modifications(tags),
      frequent_service_providers: analyze_service_providers(tags),
      premium_product_usage: analyze_premium_products(tags)
    }
  end

  defp identify_market_opportunities(tags) do
    damage_tags = Enum.filter(tags, &(&1.tag_type == "damage"))
    modification_tags = Enum.filter(tags, &(&1.tag_type == "modification"))

    %{
      damage_repair_opportunities: %{
        total_damage_tags: length(damage_tags),
        unaddressed_severe_damage: Enum.count(damage_tags, &(&1.severity_level in ["severe", "critical"] && !&1.service_id)),
        estimated_market_value: calculate_damage_market_value(damage_tags)
      },
      modification_opportunities: %{
        total_modifications: length(modification_tags),
        pending_installations: Enum.count(modification_tags, &(&1.service_status in ["needed", "approved"])),
        professional_service_rate: Enum.count(modification_tags, &(&1.technician_id != nil)) / max(length(modification_tags), 1)
      },
      product_demand_analysis: analyze_product_demand(tags),
      service_gap_analysis: analyze_service_gaps(tags)
    }
  end

  defp analyze_high_value_modifications(tags) do
    modification_tags = Enum.filter(tags, &(&1.tag_type == "modification"))

    high_value = Enum.filter(modification_tags, fn tag ->
      (tag.service_cost_cents || tag.estimated_cost_cents || 0) > 50000
    end)

    %{
      count: length(high_value),
      avg_value: if(Enum.empty?(high_value), do: 0, else:
        high_value |> Enum.map(&((&1.service_cost_cents || &1.estimated_cost_cents || 0))) |> Enum.sum() |> div(length(high_value))
      )
    }
  end

  defp analyze_service_providers(tags) do
    provider_frequencies = tags
      |> Enum.filter(&(&1.shop_id != nil))
      |> Enum.group_by(& &1.shop_id)
      |> Enum.map(fn {shop_id, shop_tags} -> {shop_id, length(shop_tags)} end)
      |> Enum.sort_by(&elem(&1, 1), :desc)
      |> Enum.take(10)

    %{
      top_service_providers: provider_frequencies,
      total_professional_services: length(Enum.filter(tags, &(&1.shop_id != nil)))
    }
  end

  defp analyze_premium_products(tags) do
    product_tags = Enum.filter(tags, &(&1.product_id != nil))

    premium_count = Enum.count(product_tags, fn tag ->
      tag.product && (tag.product.price_cents || 0) > 25000
    end)

    %{
      premium_product_usage_rate: premium_count / max(length(product_tags), 1),
      total_premium_products: premium_count
    }
  end

  defp calculate_damage_market_value(damage_tags) do
    damage_tags
    |> Enum.map(&((&1.estimated_cost_cents || 0) * severity_cost_multiplier(&1.severity_level)))
    |> Enum.sum()
  end

  defp analyze_product_demand(tags) do
    product_tags = Enum.filter(tags, &(&1.product_id != nil))

    demand_by_category = product_tags
      |> Enum.group_by(&(&1.product && &1.product.category))
      |> Enum.map(fn {category, category_tags} -> {category, length(category_tags)} end)
      |> Enum.sort_by(&elem(&1, 1), :desc)

    %{
      demand_by_category: demand_by_category,
      total_product_references: length(product_tags)
    }
  end

  defp analyze_service_gaps(tags) do
    damage_without_service = Enum.count(tags, &(&1.tag_type == "damage" && !&1.service_id))
    modifications_without_professional = Enum.count(tags, &(&1.tag_type == "modification" && !&1.technician_id))

    %{
      unserviced_damage_count: damage_without_service,
      diy_modifications: modifications_without_professional,
      professional_conversion_opportunity: modifications_without_professional
    }
  end

  defp translate_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end
end