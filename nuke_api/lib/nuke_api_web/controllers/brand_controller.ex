defmodule NukeApiWeb.BrandController do
  use NukeApiWeb, :controller

  alias NukeApi.Brands
  alias NukeApi.Brands.Brand

  action_fallback NukeApiWeb.FallbackController

  @doc """
  Lists all brands with optional filtering.
  """
  def index(conn, params) do
    opts = []
    opts = if params["industry"], do: Keyword.put(opts, :industry, params["industry"]), else: opts
    opts = if params["category"], do: Keyword.put(opts, :category, params["category"]), else: opts
    opts = if params["claimed_only"] == "true", do: Keyword.put(opts, :claimed_only, true), else: opts

    brands = Brands.list_brands(opts)

    conn
    |> json(%{
      data: brands,
      count: length(brands)
    })
  end

  @doc """
  Shows a specific brand with analytics.
  """
  def show(conn, %{"id" => id}) do
    case Brands.get_brand!(id) do
      %Brand{} = _brand ->
        analytics = Brands.get_brand_analytics(id)

        conn
        |> json(%{data: analytics})

      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Brand not found"})
    end
  end

  @doc """
  Gets a brand by slug.
  """
  def show_by_slug(conn, %{"slug" => slug}) do
    case Brands.get_brand_by_slug(slug) do
      %Brand{} = brand ->
        analytics = Brands.get_brand_analytics(brand.id)

        conn
        |> json(%{data: analytics})

      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Brand not found"})
    end
  end

  @doc """
  Creates a new brand.
  """
  def create(conn, %{"brand" => brand_params}) do
    with true <- conn.assigns.authenticated,
         {:ok, %Brand{} = brand} <- Brands.create_brand(brand_params) do

      conn
      |> put_status(:created)
      |> json(%{data: brand})
    else
      false ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "Authentication required"})

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

  @doc """
  Claims a brand for the authenticated user.
  """
  def claim(conn, %{"id" => id} = params) do
    brand = Brands.get_brand!(id)
    claim_notes = Map.get(params, "claim_notes", "")

    with true <- conn.assigns.authenticated,
         nil <- brand.claimed_by, # Brand must not already be claimed
         {:ok, %Brand{} = claimed_brand} <- Brands.claim_brand(brand, conn.assigns.current_user_id, claim_notes) do

      conn
      |> json(%{
        data: claimed_brand,
        message: "Brand claim submitted successfully. Verification pending."
      })
    else
      false ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "Authentication required"})

      claimed_user_id when not is_nil(claimed_user_id) ->
        conn
        |> put_status(:conflict)
        |> json(%{error: "Brand is already claimed by another user"})

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

  @doc """
  Gets brand analytics and tag data for claimed brands.
  """
  def analytics(conn, %{"id" => id} = params) do
    brand = Brands.get_brand!(id)

    with true <- conn.assigns.authenticated,
         true <- can_access_analytics?(conn, brand) do

      # Get comprehensive analytics
      analytics = Brands.get_brand_analytics(id)

      # Get brand tags with optional filtering
      tag_opts = []
      tag_opts = if params["min_confidence"], do: Keyword.put(tag_opts, :min_confidence, String.to_integer(params["min_confidence"])), else: tag_opts
      tag_opts = if params["verified_only"] == "true", do: Keyword.put(tag_opts, :verified_only, true), else: tag_opts

      brand_tags = Brands.list_brand_tags_for_brand(id, tag_opts)

      conn
      |> json(%{
        analytics: analytics,
        recent_tags: brand_tags,
        filters_applied: tag_opts
      })
    else
      false ->
        conn
        |> put_status(:forbidden)
        |> json(%{error: "You are not authorized to access analytics for this brand"})
    end
  end

  @doc """
  Lists all brand tags for a specific image (public endpoint).
  """
  def image_brands(conn, %{"image_id" => image_id}) do
    brand_tags = Brands.list_brand_tags_for_image(image_id)

    conn
    |> json(%{
      data: brand_tags,
      count: length(brand_tags),
      image_id: image_id
    })
  end

  @doc """
  Links a brand to a spatial tag in an image (authenticated).
  """
  def link_to_spatial_tag(conn, %{"id" => brand_id} = params) do
    image_id = params["image_id"]
    spatial_tag_id = params["spatial_tag_id"]

    with true <- conn.assigns.authenticated,
         %Brand{} = _brand <- Brands.get_brand!(brand_id),
         {:ok, brand_tag} <- Brands.link_brand_to_spatial_tag(
           brand_id,
           image_id,
           spatial_tag_id,
           tag_type: params["tag_type"] || "product",
           confidence_score: params["confidence_score"] || 70,
           detected_method: "manual_linking",
           metadata: %{linked_by: conn.assigns.current_user_id}
         ) do

      conn
      |> put_status(:created)
      |> json(%{data: brand_tag, message: "Brand linked to spatial tag successfully"})
    else
      false ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "Authentication required"})

      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Brand not found"})

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

  @doc """
  Auto-detects brands in a spatial tag's text.
  """
  def auto_detect_in_tag(conn, %{"image_id" => image_id, "spatial_tag_id" => spatial_tag_id, "tag_text" => tag_text}) do
    with true <- conn.assigns.authenticated do
      detected_associations = Brands.auto_detect_brands_in_tag(image_id, spatial_tag_id, tag_text)

      successful_links = Enum.filter(detected_associations, fn
        {:ok, _} -> true
        _ -> false
      end) |> Enum.map(fn {:ok, brand_tag} -> brand_tag end)

      failed_links = Enum.filter(detected_associations, fn
        {:error, _} -> true
        _ -> false
      end)

      conn
      |> json(%{
        successful_links: successful_links,
        failed_links: length(failed_links),
        total_detected: length(detected_associations),
        message: "Auto-detection completed. #{length(successful_links)} brands linked successfully."
      })
    else
      false ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "Authentication required"})
    end
  end

  @doc """
  Gets top brands by tag count (public analytics).
  """
  def top_brands(conn, params) do
    limit = case params["limit"] do
      nil -> 10
      limit_str -> String.to_integer(limit_str)
    end

    top_brands = Brands.get_top_brands(limit)

    conn
    |> json(%{
      data: top_brands,
      count: length(top_brands)
    })
  end

  @doc """
  Searches brands by name or alias.
  """
  def search(conn, %{"q" => query}) when is_binary(query) and byte_size(query) > 0 do
    # Simple search implementation - can be enhanced with full-text search
    brands = Brands.find_brand_by_name_or_alias(query)

    results = case brands do
      %Brand{} = brand -> [brand]
      brands when is_list(brands) -> brands
      nil -> []
    end

    conn
    |> json(%{
      data: results,
      count: length(results),
      query: query
    })
  end

  def search(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "Search query parameter 'q' is required"})
  end

  # =====================================================================================
  # PRIVATE HELPER FUNCTIONS
  # =====================================================================================

  defp can_access_analytics?(conn, %Brand{} = brand) do
    # Brand owners can access analytics, or admins
    conn.assigns.current_user_id == brand.claimed_by
    # TODO: Add admin role check when implemented
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end
end