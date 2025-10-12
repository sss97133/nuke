defmodule NukeApi.Brands do
  @moduledoc """
  The Brands context - manages brand entities, aliases, and tag associations.

  Core functions for the corporate data harvesting system that allows companies
  like Chevrolet, Snap-on, Miller, etc. to claim and analyze their tagged content.
  """

  import Ecto.Query, warn: false
  alias NukeApi.Repo

  alias NukeApi.Brands.{Brand, BrandAlias, BrandTag}

  # =====================================================================================
  # BRAND MANAGEMENT
  # =====================================================================================

  @doc """
  Returns the list of brands.

  ## Examples

      iex> list_brands()
      [%Brand{}, ...]

  """
  def list_brands(opts \\ []) do
    query = Brand
    query = maybe_filter_by_industry(query, opts[:industry])
    query = maybe_filter_by_category(query, opts[:category])
    query = maybe_filter_claimed_only(query, opts[:claimed_only])

    Repo.all(query)
  end

  @doc """
  Gets a single brand.

  Raises `Ecto.NoResultsError` if the Brand does not exist.

  ## Examples

      iex> get_brand!(123)
      %Brand{}

      iex> get_brand!(456)
      ** (Ecto.NoResultsError)

  """
  def get_brand!(id), do: Repo.get!(Brand, id)

  @doc """
  Gets a brand by slug.
  """
  def get_brand_by_slug(slug) do
    Repo.get_by(Brand, slug: slug)
  end

  @doc """
  Creates a brand.

  ## Examples

      iex> create_brand(%{field: value})
      {:ok, %Brand{}}

      iex> create_brand(%{field: bad_value})
      {:error, %Ecto.Changeset{}}

  """
  def create_brand(attrs \\ %{}) do
    %Brand{}
    |> Brand.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Updates a brand.

  ## Examples

      iex> update_brand(brand, %{field: new_value})
      {:ok, %Brand{}}

      iex> update_brand(brand, %{field: bad_value})
      {:error, %Ecto.Changeset{}}

  """
  def update_brand(%Brand{} = brand, attrs) do
    brand
    |> Brand.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Claims a brand for a user.
  """
  def claim_brand(%Brand{} = brand, claimer_user_id, claim_notes \\ "") do
    brand
    |> Brand.claim_changeset(claimer_user_id, claim_notes)
    |> Repo.update()
  end

  @doc """
  Verifies a brand claim.
  """
  def verify_brand_claim(%Brand{} = brand, verification_status, verification_contact \\ nil) do
    brand
    |> Brand.verify_changeset(verification_status, verification_contact)
    |> Repo.update()
  end

  @doc """
  Deletes a brand.

  ## Examples

      iex> delete_brand(brand)
      {:ok, %Brand{}}

      iex> delete_brand(brand)
      {:error, %Ecto.Changeset{}}

  """
  def delete_brand(%Brand{} = brand) do
    Repo.delete(brand)
  end

  @doc """
  Returns an `%Ecto.Changeset{}` for tracking brand changes.

  ## Examples

      iex> change_brand(brand)
      %Ecto.Changeset{data: %Brand{}}

  """
  def change_brand(%Brand{} = brand, attrs \\ %{}) do
    Brand.changeset(brand, attrs)
  end

  # =====================================================================================
  # BRAND ALIAS MANAGEMENT
  # =====================================================================================

  @doc """
  Creates a brand alias.
  """
  def create_brand_alias(attrs \\ %{}) do
    %BrandAlias{}
    |> BrandAlias.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Lists all aliases for a brand.
  """
  def list_brand_aliases(brand_id) do
    BrandAlias
    |> where([a], a.brand_id == ^brand_id)
    |> Repo.all()
  end

  @doc """
  Finds a brand by any of its aliases (case-insensitive).
  """
  def find_brand_by_name_or_alias(name) when is_binary(name) do
    # First try exact brand name match
    case Repo.get_by(Brand, name: name) do
      %Brand{} = brand -> brand
      nil ->
        # Then try alias match
        BrandAlias.find_brand_by_alias(name)
        |> Repo.one()
    end
  end

  @doc """
  Bulk creates aliases for a brand.
  """
  def create_brand_aliases(brand_id, aliases) when is_list(aliases) do
    timestamp = NaiveDateTime.utc_now() |> NaiveDateTime.truncate(:second)

    aliases_data = Enum.map(aliases, fn
      {alias_name, alias_type} ->
        %{
          brand_id: brand_id,
          alias_name: alias_name,
          alias_type: alias_type,
          created_at: timestamp
        }
      alias_name when is_binary(alias_name) ->
        %{
          brand_id: brand_id,
          alias_name: alias_name,
          alias_type: "common",
          created_at: timestamp
        }
    end)

    Repo.insert_all(BrandAlias, aliases_data, on_conflict: :nothing)
  end

  # =====================================================================================
  # BRAND TAG ASSOCIATION MANAGEMENT
  # =====================================================================================

  @doc """
  Creates a brand tag association.
  """
  def create_brand_tag(attrs \\ %{}) do
    %BrandTag{}
    |> BrandTag.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Links a brand to a spatial tag in an image.
  """
  def link_brand_to_spatial_tag(brand_id, image_id, spatial_tag_id, opts \\ []) do
    attrs = %{
      brand_id: brand_id,
      image_id: image_id,
      spatial_tag_id: spatial_tag_id,
      tag_type: opts[:tag_type] || "product",
      confidence_score: opts[:confidence_score] || 50,
      detected_method: opts[:detected_method] || "manual_linking",
      detection_metadata: opts[:metadata] || %{}
    }

    create_brand_tag(attrs)
  end

  @doc """
  Auto-detects brands in a spatial tag's text and creates associations.
  """
  def auto_detect_brands_in_tag(image_id, spatial_tag_id, tag_text) do
    detected_brands = detect_brand_mentions(tag_text)

    Enum.map(detected_brands, fn {brand, confidence, method} ->
      link_brand_to_spatial_tag(brand.id, image_id, spatial_tag_id,
        tag_type: "product",
        confidence_score: confidence,
        detected_method: method,
        metadata: %{original_text: tag_text}
      )
    end)
  end

  @doc """
  Gets brand tags for an image.
  """
  def list_brand_tags_for_image(image_id) do
    BrandTag.for_image(image_id)
    |> Repo.all()
  end

  @doc """
  Gets brand tags for a brand (for analytics).
  """
  def list_brand_tags_for_brand(brand_id, opts \\ []) do
    query = BrandTag.for_brand(brand_id)

    query = if opts[:min_confidence] do
      BrandTag.high_confidence(query, opts[:min_confidence])
    else
      query
    end

    query = if opts[:verified_only] do
      where(query, [bt], bt.verification_status == "verified")
    else
      query
    end

    Repo.all(query)
  end

  @doc """
  Verifies a brand tag.
  """
  def verify_brand_tag(%BrandTag{} = brand_tag, verifier_user_id, verification_status) do
    brand_tag
    |> BrandTag.verify_changeset(verifier_user_id, verification_status)
    |> Repo.update()
  end

  # =====================================================================================
  # ANALYTICS & REPORTING
  # =====================================================================================

  @doc """
  Gets analytics for a brand.
  """
  def get_brand_analytics(brand_id) do
    brand = get_brand!(brand_id)

    # Get tag counts by type
    tag_counts = from(bt in BrandTag,
      where: bt.brand_id == ^brand_id,
      group_by: bt.tag_type,
      select: {bt.tag_type, count()}
    ) |> Repo.all() |> Enum.into(%{})

    # Get verification status counts
    verification_counts = from(bt in BrandTag,
      where: bt.brand_id == ^brand_id,
      group_by: bt.verification_status,
      select: {bt.verification_status, count()}
    ) |> Repo.all() |> Enum.into(%{})

    # Get monthly tag creation trend (last 12 months)
    monthly_tags = from(bt in BrandTag,
      where: bt.brand_id == ^brand_id and bt.inserted_at >= ago(12, "month"),
      group_by: fragment("date_trunc('month', ?)", bt.inserted_at),
      select: {fragment("date_trunc('month', ?)", bt.inserted_at), count()},
      order_by: fragment("date_trunc('month', ?)", bt.inserted_at)
    ) |> Repo.all()

    %{
      brand: brand,
      total_tags: brand.total_tags,
      total_verified_tags: brand.total_verified_tags,
      tag_counts: tag_counts,
      verification_counts: verification_counts,
      monthly_trend: monthly_tags,
      first_tagged: brand.first_tagged_at,
      last_tagged: brand.last_tagged_at
    }
  end

  @doc """
  Gets top brands by tag count.
  """
  def get_top_brands(limit \\ 10) do
    from(b in Brand,
      where: b.total_tags > 0,
      order_by: [desc: b.total_tags],
      limit: ^limit
    )
    |> Repo.all()
  end

  # =====================================================================================
  # PRIVATE HELPER FUNCTIONS
  # =====================================================================================

  defp maybe_filter_by_industry(query, nil), do: query
  defp maybe_filter_by_industry(query, industry) do
    where(query, [b], b.industry == ^industry)
  end

  defp maybe_filter_by_category(query, nil), do: query
  defp maybe_filter_by_category(query, category) do
    where(query, [b], b.category == ^category)
  end

  defp maybe_filter_claimed_only(query, true) do
    where(query, [b], not is_nil(b.claimed_at))
  end
  defp maybe_filter_claimed_only(query, _), do: query

  # Brand detection algorithm - matches text against brand names and aliases
  defp detect_brand_mentions(text) when is_binary(text) do
    # Convert to lowercase for case-insensitive matching
    text_lower = String.downcase(text)

    # Get all brands with their aliases
    brands_with_aliases = from(b in Brand,
      left_join: a in BrandAlias, on: a.brand_id == b.id,
      select: {b, b.name, a.alias_name}
    ) |> Repo.all()

    # Check for brand mentions
    Enum.reduce(brands_with_aliases, [], fn {brand, brand_name, alias_name}, acc ->
      cond do
        # Check brand name match
        brand_name && String.contains?(text_lower, String.downcase(brand_name)) ->
          confidence = calculate_mention_confidence(text, brand_name)
          [{brand, confidence, "name_match"} | acc]

        # Check alias match
        alias_name && String.contains?(text_lower, String.downcase(alias_name)) ->
          confidence = calculate_mention_confidence(text, alias_name)
          [{brand, confidence, "alias_match"} | acc]

        true -> acc
      end
    end)
    |> Enum.uniq_by(fn {brand, _, _} -> brand.id end) # Remove duplicates
  end

  # Calculate confidence score based on how the brand is mentioned
  defp calculate_mention_confidence(text, brand_name) do
    text_length = String.length(text)
    brand_length = String.length(brand_name)

    base_confidence = 60

    # Higher confidence for shorter text (more focused)
    length_bonus = max(0, 40 - div(text_length, 10))

    # Higher confidence if brand name is significant portion of text
    relevance_bonus = min(20, div(brand_length * 100, text_length))

    min(95, base_confidence + length_bonus + relevance_bonus)
  end
end