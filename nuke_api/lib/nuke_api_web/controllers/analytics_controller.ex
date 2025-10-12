defmodule NukeApiWeb.AnalyticsController do
  use NukeApiWeb, :controller

  alias NukeApi.Analytics.TagAnalytics

  action_fallback NukeApiWeb.FallbackController

  @doc """
  Returns comprehensive tag analytics for the dashboard.
  """
  def dashboard(conn, params) do
    date_range = parse_date_range(params)
    analytics = TagAnalytics.generate_comprehensive_analytics(date_range)

    conn
    |> json(%{
      data: analytics,
      date_range: date_range,
      generated_at: DateTime.utc_now()
    })
  end

  @doc """
  Returns overview statistics.
  """
  def overview(conn, params) do
    date_range = parse_date_range(params)
    overview = TagAnalytics.generate_overview_stats(date_range)

    conn
    |> json(%{
      data: overview,
      date_range: date_range
    })
  end

  @doc """
  Returns trending tags and brands.
  """
  def trending(conn, params) do
    date_range = parse_date_range(params)
    limit = case params["limit"] do
      nil -> 20
      limit_str -> String.to_integer(limit_str)
    end

    trending_tags = TagAnalytics.get_trending_tags(date_range, limit)
    popular_brands = TagAnalytics.get_popular_brands(date_range, limit)

    conn
    |> json(%{
      data: %{
        trending_tags: trending_tags,
        popular_brands: popular_brands
      },
      date_range: date_range,
      limit: limit
    })
  end

  @doc """
  Returns user engagement statistics.
  """
  def user_engagement(conn, params) do
    date_range = parse_date_range(params)
    engagement = TagAnalytics.get_user_engagement_stats(date_range)

    conn
    |> json(%{
      data: engagement,
      date_range: date_range
    })
  end

  @doc """
  Returns verification quality statistics.
  """
  def verification_quality(conn, params) do
    date_range = parse_date_range(params)
    quality_stats = TagAnalytics.get_verification_quality_stats(date_range)

    conn
    |> json(%{
      data: quality_stats,
      date_range: date_range
    })
  end

  @doc """
  Returns geographic distribution of tags.
  """
  def geographic(conn, params) do
    date_range = parse_date_range(params)
    geographic_data = TagAnalytics.get_geographic_distribution(date_range)

    conn
    |> json(%{
      data: geographic_data,
      date_range: date_range
    })
  end

  @doc """
  Returns tag type breakdown.
  """
  def tag_types(conn, params) do
    date_range = parse_date_range(params)
    tag_types = TagAnalytics.get_tag_type_breakdown(date_range)

    conn
    |> json(%{
      data: tag_types,
      date_range: date_range
    })
  end

  @doc """
  Returns monthly trends.
  """
  def monthly_trends(conn, params) do
    date_range = parse_date_range(params)
    trends = TagAnalytics.get_monthly_trends(date_range)

    conn
    |> json(%{
      data: trends,
      date_range: date_range
    })
  end

  @doc """
  Exports analytics data in various formats.
  """
  def export(conn, params) do
    format = case params["format"] do
      "csv" -> :csv
      "json" -> :json
      _ -> :json
    end

    date_range = parse_date_range(params)

    case TagAnalytics.export_analytics_data(format, date_range) do
      {:ok, data} ->
        content_type = case format do
          :csv -> "text/csv"
          :json -> "application/json"
        end

        filename = "tag_analytics_#{Date.utc_today()}.#{format}"

        conn
        |> put_resp_content_type(content_type)
        |> put_resp_header("content-disposition", "attachment; filename=\"#{filename}\"")
        |> send_resp(200, data)

      {:error, reason} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "Export failed: #{reason}"})

      data when is_binary(data) ->
        content_type = case format do
          :csv -> "text/csv"
          :json -> "application/json"
        end

        filename = "tag_analytics_#{Date.utc_today()}.#{format}"

        conn
        |> put_resp_content_type(content_type)
        |> put_resp_header("content-disposition", "attachment; filename=\"#{filename}\"")
        |> send_resp(200, data)
    end
  end

  @doc """
  Returns real-time analytics for live dashboards.
  """
  def realtime(conn, _params) do
    # Get last 24 hours of activity
    yesterday = DateTime.utc_now() |> DateTime.add(-24 * 60 * 60, :second)
    today = DateTime.utc_now()

    date_range = %{start: yesterday, end: today}

    analytics = %{
      recent_activity: TagAnalytics.generate_overview_stats(date_range),
      trending_now: TagAnalytics.get_trending_tags(date_range, 10),
      active_users: TagAnalytics.get_user_engagement_stats(date_range),
      quality_metrics: TagAnalytics.get_verification_quality_stats(date_range)
    }

    conn
    |> json(%{
      data: analytics,
      timestamp: DateTime.utc_now(),
      timeframe: "last_24_hours"
    })
  end

  @doc """
  Returns brand-specific analytics (for claimed brands).
  """
  def brand_analytics(conn, %{"brand_id" => brand_id} = params) do
    # This would require authorization check to ensure user owns the brand
    # For now, returning public analytics

    date_range = parse_date_range(params)

    # Get brand analytics (this would be implemented in the Brands context)
    case NukeApi.Brands.get_brand_analytics(brand_id) do
      analytics when is_map(analytics) ->
        conn
        |> json(%{
          data: analytics,
          brand_id: brand_id,
          date_range: date_range
        })

      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Brand not found"})
    end
  end

  @doc """
  Returns analytics for a specific image's tags.
  """
  def image_analytics(conn, %{"image_id" => image_id}) do
    # Get image tag analytics
    case NukeApi.Vehicles.get_image(image_id) do
      %NukeApi.Vehicles.Image{} = image ->
        tags = image.spatial_tags || []

        analytics = %{
          total_tags: length(tags),
          tag_types: count_tag_types(tags),
          verification_status: count_verification_status(tags),
          average_trust_score: calculate_average_trust_score(tags),
          creation_timeline: get_tag_creation_timeline(tags),
          verification_activity: get_verification_activity(image_id)
        }

        conn
        |> json(%{
          data: analytics,
          image_id: image_id
        })

      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Image not found"})
    end
  end

  # =====================================================================================
  # PRIVATE HELPER FUNCTIONS
  # =====================================================================================

  defp parse_date_range(params) do
    case {params["start_date"], params["end_date"]} do
      {start_str, end_str} when is_binary(start_str) and is_binary(end_str) ->
        with {:ok, start_date} <- Date.from_iso8601(start_str),
             {:ok, end_date} <- Date.from_iso8601(end_str) do
          %{start: start_date, end: end_date}
        else
          _ -> nil
        end
      _ -> nil
    end
  end

  defp count_tag_types(tags) do
    Enum.reduce(tags, %{}, fn tag, acc ->
      type = tag["type"] || "unknown"
      Map.update(acc, type, 1, &(&1 + 1))
    end)
  end

  defp count_verification_status(tags) do
    Enum.reduce(tags, %{}, fn tag, acc ->
      status = tag["verification_status"] || "unknown"
      Map.update(acc, status, 1, &(&1 + 1))
    end)
  end

  defp calculate_average_trust_score(tags) do
    if length(tags) == 0 do
      0
    else
      total_score = Enum.reduce(tags, 0, fn tag, acc ->
        acc + (tag["trust_score"] || 0)
      end)
      total_score / length(tags)
    end
  end

  defp get_tag_creation_timeline(tags) do
    tags
    |> Enum.filter(fn tag -> tag["created_at"] end)
    |> Enum.map(fn tag -> %{
        id: tag["id"],
        created_at: tag["created_at"],
        type: tag["type"],
        trust_score: tag["trust_score"]
      } end)
    |> Enum.sort_by(fn tag -> tag.created_at end)
  end

  defp get_verification_activity(image_id) do
    # Get all verifications for spatial tags in this image
    NukeApi.Verification.list_tag_verifications(image_id, nil) # Would need to be modified to handle nil spatial_tag_id
  end
end