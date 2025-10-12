defmodule NukeApi.Analytics.TagAnalytics do
  @moduledoc """
  Analytics service for comprehensive tag reporting and insights.

  Generates analytics for tagged data, trending tags, popular brands,
  user engagement, and data quality metrics.
  """

  import Ecto.Query, warn: false
  alias NukeApi.Repo

  alias NukeApi.Brands.{Brand, BrandTag}
  alias NukeApi.Vehicles.Image
  alias NukeApi.Verification.TagVerification

  @doc """
  Generates comprehensive tag analytics for a given time period.
  """
  def generate_comprehensive_analytics(date_range \\ nil) do
    %{
      overview: generate_overview_stats(date_range),
      trending_tags: get_trending_tags(date_range),
      popular_brands: get_popular_brands(date_range),
      user_engagement: get_user_engagement_stats(date_range),
      verification_quality: get_verification_quality_stats(date_range),
      geographic_distribution: get_geographic_distribution(date_range),
      tag_type_breakdown: get_tag_type_breakdown(date_range),
      monthly_trends: get_monthly_trends(date_range)
    }
  end

  @doc """
  Generates overview statistics.
  """
  def generate_overview_stats(date_range \\ nil) do
    base_query = if date_range do
      from(i in Image,
        where: i.created_at >= ^date_range.start and i.created_at <= ^date_range.end
      )
    else
      Image
    end

    # Total images with tags
    total_tagged_images = from(i in base_query,
      where: not is_nil(i.spatial_tags) and fragment("jsonb_array_length(?)", i.spatial_tags) > 0,
      select: count()
    ) |> Repo.one() || 0

    # Total spatial tags across all images
    total_spatial_tags = from(i in base_query,
      where: not is_nil(i.spatial_tags),
      select: fragment("SUM(jsonb_array_length(?))", i.spatial_tags)
    ) |> Repo.one() || 0

    # Total brand associations
    total_brand_tags = if date_range do
      from(bt in BrandTag,
        where: bt.inserted_at >= ^date_range.start and bt.inserted_at <= ^date_range.end,
        select: count()
      ) |> Repo.one() || 0
    else
      Repo.aggregate(BrandTag, :count)
    end

    # Total verifications
    total_verifications = if date_range do
      from(tv in TagVerification,
        where: tv.created_at >= ^date_range.start and tv.created_at <= ^date_range.end,
        select: count()
      ) |> Repo.one() || 0
    else
      Repo.aggregate(TagVerification, :count)
    end

    # Unique users who have tagged
    unique_taggers = if date_range do
      from(tv in TagVerification,
        where: tv.created_at >= ^date_range.start and tv.created_at <= ^date_range.end,
        select: count(tv.verifier_user_id, :distinct)
      ) |> Repo.one() || 0
    else
      from(tv in TagVerification,
        select: count(tv.verifier_user_id, :distinct)
      ) |> Repo.one() || 0
    end

    %{
      total_tagged_images: total_tagged_images,
      total_spatial_tags: total_spatial_tags,
      total_brand_tags: total_brand_tags,
      total_verifications: total_verifications,
      unique_taggers: unique_taggers,
      average_tags_per_image: if(total_tagged_images > 0, do: total_spatial_tags / total_tagged_images, else: 0)
    }
  end

  @doc """
  Gets trending tags based on recent activity.
  """
  def get_trending_tags(date_range \\ nil, limit \\ 20) do
    # This is a complex query that would analyze tag text patterns
    # For now, returning a simplified version based on brand tags
    base_query = if date_range do
      from(bt in BrandTag,
        where: bt.inserted_at >= ^date_range.start and bt.inserted_at <= ^date_range.end
      )
    else
      BrandTag
    end

    from(bt in base_query,
      join: b in Brand, on: bt.brand_id == b.id,
      group_by: [b.id, b.name],
      select: %{
        brand_id: b.id,
        brand_name: b.name,
        tag_count: count(bt.id),
        industry: b.industry,
        verification_rate: fragment(
          "ROUND(AVG(CASE WHEN ? = 'verified' THEN 100.0 ELSE 0.0 END), 2)",
          bt.verification_status
        )
      },
      order_by: [desc: count(bt.id)],
      limit: ^limit
    )
    |> Repo.all()
  end

  @doc """
  Gets popular brands by tag activity.
  """
  def get_popular_brands(date_range \\ nil, limit \\ 15) do
    base_query = if date_range do
      from(bt in BrandTag,
        where: bt.inserted_at >= ^date_range.start and bt.inserted_at <= ^date_range.end
      )
    else
      BrandTag
    end

    from(bt in base_query,
      join: b in Brand, on: bt.brand_id == b.id,
      group_by: [b.id, b.name, b.industry, b.category, b.verification_status],
      select: %{
        brand: b,
        tag_count: count(bt.id),
        verified_tag_count: count(bt.id) |> filter(bt.verification_status == "verified"),
        avg_confidence: avg(bt.confidence_score),
        latest_activity: max(bt.inserted_at)
      },
      order_by: [desc: count(bt.id)],
      limit: ^limit
    )
    |> Repo.all()
  end

  @doc """
  Gets user engagement statistics.
  """
  def get_user_engagement_stats(date_range \\ nil) do
    base_query = if date_range do
      from(tv in TagVerification,
        where: tv.created_at >= ^date_range.start and tv.created_at <= ^date_range.end
      )
    else
      TagVerification
    end

    # Top contributors
    top_contributors = from(tv in base_query,
      group_by: tv.verifier_user_id,
      select: %{
        user_id: tv.verifier_user_id,
        total_verifications: count(),
        verification_types: fragment("array_agg(DISTINCT ?)", tv.verifier_type),
        trust_impact: sum(tv.trust_score_impact)
      },
      order_by: [desc: count()],
      limit: 10
    ) |> Repo.all()

    # Verification distribution
    verification_distribution = from(tv in base_query,
      group_by: tv.verifier_type,
      select: {tv.verifier_type, count()}
    ) |> Repo.all() |> Enum.into(%{})

    # Action distribution
    action_distribution = from(tv in base_query,
      group_by: tv.action,
      select: {tv.action, count()}
    ) |> Repo.all() |> Enum.into(%{})

    %{
      top_contributors: top_contributors,
      verification_distribution: verification_distribution,
      action_distribution: action_distribution
    }
  end

  @doc """
  Gets verification quality statistics.
  """
  def get_verification_quality_stats(date_range \\ nil) do
    base_query = if date_range do
      from(tv in TagVerification,
        where: tv.created_at >= ^date_range.start and tv.created_at <= ^date_range.end
      )
    else
      TagVerification
    end

    # Average trust score impact
    avg_trust_impact = from(tv in base_query,
      select: avg(tv.trust_score_impact)
    ) |> Repo.one() || 0

    # Professional vs peer accuracy
    professional_stats = from(tv in base_query,
      where: tv.verifier_type == "professional",
      select: %{
        count: count(),
        avg_impact: avg(tv.trust_score_impact),
        positive_rate: fragment(
          "ROUND(AVG(CASE WHEN ? > 0 THEN 100.0 ELSE 0.0 END), 2)",
          tv.trust_score_impact
        )
      }
    ) |> Repo.one()

    peer_stats = from(tv in base_query,
      where: tv.verifier_type == "peer",
      select: %{
        count: count(),
        avg_impact: avg(tv.trust_score_impact),
        positive_rate: fragment(
          "ROUND(AVG(CASE WHEN ? > 0 THEN 100.0 ELSE 0.0 END), 2)",
          tv.trust_score_impact
        )
      }
    ) |> Repo.one()

    %{
      average_trust_impact: avg_trust_impact,
      professional_stats: professional_stats,
      peer_stats: peer_stats
    }
  end

  @doc """
  Gets geographic distribution of tags (based on GPS data).
  """
  def get_geographic_distribution(date_range \\ nil) do
    base_query = if date_range do
      from(i in Image,
        where: i.created_at >= ^date_range.start and i.created_at <= ^date_range.end
      )
    else
      Image
    end

    # Get images with GPS coordinates
    gps_distribution = from(i in base_query,
      where: not is_nil(i.latitude) and not is_nil(i.longitude),
      select: %{
        latitude: i.latitude,
        longitude: i.longitude,
        location_name: i.location_name,
        tag_count: fragment("jsonb_array_length(?)", i.spatial_tags)
      }
    ) |> Repo.all()

    # Group by approximate regions (simplified)
    regions = group_by_regions(gps_distribution)

    %{
      total_gps_tagged: length(gps_distribution),
      regional_distribution: regions,
      sample_coordinates: Enum.take(gps_distribution, 100) # For mapping
    }
  end

  @doc """
  Gets breakdown of tag types.
  """
  def get_tag_type_breakdown(date_range \\ nil) do
    # This would analyze the spatial_tags JSONB data
    # Complex query to extract type information from JSONB arrays

    base_query = if date_range do
      from(i in Image,
        where: i.created_at >= ^date_range.start and i.created_at <= ^date_range.end
      )
    else
      Image
    end

    # Extract tag types from JSONB spatial_tags
    _tag_types = from(i in base_query,
      where: not is_nil(i.spatial_tags),
      select: fragment(
        """
        SELECT tag_type, COUNT(*) as count
        FROM (
          SELECT jsonb_array_elements(?)->>'type' as tag_type
          FROM vehicle_images
          WHERE spatial_tags IS NOT NULL
        ) types
        GROUP BY tag_type
        """,
        i.spatial_tags
      )
    )

    # For now, return a simplified version based on brand tag types
    from(bt in BrandTag,
      group_by: bt.tag_type,
      select: {bt.tag_type, count()}
    ) |> Repo.all() |> Enum.into(%{})
  end

  @doc """
  Gets monthly trends for tag creation.
  """
  def get_monthly_trends(date_range \\ nil) do
    start_date = if date_range do
      date_range.start
    else
      # Default to last 12 months
      Date.utc_today() |> Date.add(-365)
    end

    end_date = if date_range do
      date_range.end
    else
      Date.utc_today()
    end

    # Monthly brand tag trends
    brand_tag_trends = from(bt in BrandTag,
      where: bt.inserted_at >= ^start_date and bt.inserted_at <= ^end_date,
      group_by: fragment("date_trunc('month', ?)", bt.inserted_at),
      select: %{
        month: fragment("date_trunc('month', ?)", bt.inserted_at),
        brand_tags: count(),
        unique_brands: count(bt.brand_id, :distinct),
        verification_rate: fragment(
          "ROUND(AVG(CASE WHEN ? = 'verified' THEN 100.0 ELSE 0.0 END), 2)",
          bt.verification_status
        )
      },
      order_by: fragment("date_trunc('month', ?)", bt.inserted_at)
    ) |> Repo.all()

    # Monthly verification trends
    verification_trends = from(tv in TagVerification,
      where: tv.created_at >= ^start_date and tv.created_at <= ^end_date,
      group_by: fragment("date_trunc('month', ?)", tv.created_at),
      select: %{
        month: fragment("date_trunc('month', ?)", tv.created_at),
        total_verifications: count(),
        unique_users: count(tv.verifier_user_id, :distinct),
        avg_trust_impact: avg(tv.trust_score_impact)
      },
      order_by: fragment("date_trunc('month', ?)", tv.created_at)
    ) |> Repo.all()

    %{
      brand_tag_trends: brand_tag_trends,
      verification_trends: verification_trends,
      date_range: %{start: start_date, end: end_date}
    }
  end

  @doc """
  Exports analytics data for external analysis or reporting.
  """
  def export_analytics_data(format \\ :json, date_range \\ nil) do
    analytics = generate_comprehensive_analytics(date_range)

    case format do
      :json ->
        Jason.encode!(analytics)
      :csv ->
        generate_csv_export(analytics)
      _ ->
        {:error, :unsupported_format}
    end
  end

  # =====================================================================================
  # PRIVATE HELPER FUNCTIONS
  # =====================================================================================

  defp group_by_regions(gps_distribution) do
    # Simple regional grouping by lat/lng ranges
    # This could be enhanced with proper geographic clustering
    Enum.group_by(gps_distribution, fn %{latitude: lat, longitude: lng} ->
      cond do
        lat > 40 and lng < -100 -> "US West"
        lat > 40 and lng > -100 -> "US East"
        lat > 30 and lng < -90 -> "US Southwest"
        lat > 30 -> "US Southeast"
        true -> "International"
      end
    end)
    |> Enum.map(fn {region, points} ->
      {region, %{
        count: length(points),
        total_tags: Enum.sum(Enum.map(points, & &1.tag_count))
      }}
    end)
    |> Enum.into(%{})
  end

  defp generate_csv_export(analytics) do
    # Generate CSV format for analytics data
    headers = ["Metric", "Value", "Category"]

    rows = [
      ["Total Tagged Images", analytics.overview.total_tagged_images, "Overview"],
      ["Total Spatial Tags", analytics.overview.total_spatial_tags, "Overview"],
      ["Total Brand Tags", analytics.overview.total_brand_tags, "Overview"],
      ["Total Verifications", analytics.overview.total_verifications, "Overview"],
      ["Unique Taggers", analytics.overview.unique_taggers, "Overview"]
    ]

    # Add trending tags
    trending_rows = Enum.map(analytics.trending_tags, fn tag ->
      ["#{tag.brand_name}", tag.tag_count, "Trending Brands"]
    end)

    all_rows = rows ++ trending_rows

    # Convert to CSV format
    csv_content = [headers | all_rows]
    |> Enum.map(&Enum.join(&1, ","))
    |> Enum.join("\n")

    csv_content
  end
end