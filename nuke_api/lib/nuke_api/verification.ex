defmodule NukeApi.Verification do
  @moduledoc """
  The Verification context - manages multi-level verification system.

  Handles tag verifications, user expertise tracking, and trust score calculations
  for the comprehensive tagging system.
  """

  import Ecto.Query, warn: false
  alias NukeApi.Repo

  alias NukeApi.Verification.{TagVerification, UserExpertise}
  alias NukeApi.Vehicles.Image
  alias NukeApi.Brands

  # =====================================================================================
  # TAG VERIFICATION MANAGEMENT
  # =====================================================================================

  @doc """
  Creates a tag verification.
  """
  def create_tag_verification(attrs \\ %{}) do
    %TagVerification{}
    |> TagVerification.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Creates a peer verification for a spatial tag.
  """
  def create_peer_verification(image_id, spatial_tag_id, verifier_user_id, action, opts \\ []) do
    TagVerification.peer_verification_changeset(image_id, spatial_tag_id, verifier_user_id, action, opts)
    |> Repo.insert()
    |> case do
      {:ok, verification} ->
        # Update the spatial tag's trust score
        update_spatial_tag_trust_score(image_id, spatial_tag_id)
        {:ok, verification}
      error -> error
    end
  end

  @doc """
  Creates a professional verification for a spatial tag.
  """
  def create_professional_verification(image_id, spatial_tag_id, verifier_user_id, action, opts) do
    TagVerification.professional_verification_changeset(image_id, spatial_tag_id, verifier_user_id, action, opts)
    |> Repo.insert()
    |> case do
      {:ok, verification} ->
        # Update the spatial tag's trust score with higher weight
        update_spatial_tag_trust_score(image_id, spatial_tag_id)
        {:ok, verification}
      error -> error
    end
  end

  @doc """
  Creates a brand representative verification.
  """
  def create_brand_verification(image_id, spatial_tag_id, verifier_user_id, action, opts) do
    TagVerification.brand_verification_changeset(image_id, spatial_tag_id, verifier_user_id, action, opts)
    |> Repo.insert()
    |> case do
      {:ok, verification} ->
        # Update both spatial tag trust score and brand tag verification
        update_spatial_tag_trust_score(image_id, spatial_tag_id)
        update_brand_tag_verification(image_id, spatial_tag_id, opts[:brand_id], action)
        {:ok, verification}
      error -> error
    end
  end

  @doc """
  Lists verifications for a specific spatial tag.
  """
  def list_tag_verifications(image_id, spatial_tag_id) do
    from(tv in TagVerification,
      where: tv.image_id == ^image_id and tv.spatial_tag_id == ^spatial_tag_id,
      order_by: [desc: tv.created_at]
    )
    |> Repo.all()
  end

  @doc """
  Gets verification statistics for a spatial tag.
  """
  def get_tag_verification_stats(image_id, spatial_tag_id) do
    base_query = from(tv in TagVerification,
      where: tv.image_id == ^image_id and tv.spatial_tag_id == ^spatial_tag_id
    )

    # Count by action
    action_counts = from(tv in base_query,
      group_by: tv.action,
      select: {tv.action, count()}
    ) |> Repo.all() |> Enum.into(%{})

    # Count by verifier type
    verifier_type_counts = from(tv in base_query,
      group_by: tv.verifier_type,
      select: {tv.verifier_type, count()}
    ) |> Repo.all() |> Enum.into(%{})

    # Calculate weighted trust impact
    total_trust_impact = from(tv in base_query,
      select: sum(tv.trust_score_impact)
    ) |> Repo.one() || 0

    %{
      total_verifications: Map.values(action_counts) |> Enum.sum(),
      action_counts: action_counts,
      verifier_type_counts: verifier_type_counts,
      total_trust_impact: total_trust_impact
    }
  end

  # =====================================================================================
  # USER EXPERTISE MANAGEMENT
  # =====================================================================================

  @doc """
  Creates user expertise record.
  """
  def create_user_expertise(attrs \\ %{}) do
    %UserExpertise{}
    |> UserExpertise.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Gets user expertise for a specific type.
  """
  def get_user_expertise(user_id, expertise_type) do
    Repo.get_by(UserExpertise, user_id: user_id, expertise_type: expertise_type)
  end

  @doc """
  Lists all expertise records for a user.
  """
  def list_user_expertise(user_id) do
    from(ue in UserExpertise,
      where: ue.user_id == ^user_id,
      order_by: [desc: ue.trust_rating]
    )
    |> Repo.all()
  end

  @doc """
  Updates user expertise after a verification.
  """
  def update_expertise_after_verification(user_id, expertise_type, verification_was_accurate) do
    case get_user_expertise(user_id, expertise_type) do
      %UserExpertise{} = expertise ->
        expertise
        |> UserExpertise.update_verification_metrics(verification_was_accurate)
        |> Repo.update()

      nil ->
        # Create new expertise record if none exists
        create_user_expertise(%{
          user_id: user_id,
          expertise_type: expertise_type,
          verification_count: 1,
          accuracy_score: if(verification_was_accurate, do: 1.0, else: 0.0),
          trust_rating: if(verification_was_accurate, do: 10, else: 0)
        })
    end
  end

  @doc """
  Gets top experts by expertise type.
  """
  def get_top_experts(expertise_type, limit \\ 10) do
    from(ue in UserExpertise,
      where: ue.expertise_type == ^expertise_type,
      order_by: [desc: ue.trust_rating, desc: ue.verification_count],
      limit: ^limit
    )
    |> Repo.all()
  end

  # =====================================================================================
  # TRUST SCORE CALCULATIONS
  # =====================================================================================

  @doc """
  Calculates and updates the trust score for a spatial tag.
  """
  def update_spatial_tag_trust_score(image_id, spatial_tag_id) do
    # Get all verifications for this tag
    verifications = list_tag_verifications(image_id, spatial_tag_id)

    # Calculate new trust score
    new_trust_score = calculate_trust_score(verifications)

    # Update the spatial tag in the image
    case NukeApi.Vehicles.get_image(image_id) do
      %Image{} = image ->
        current_tags = image.spatial_tags || []
        updated_tags = Enum.map(current_tags, fn tag ->
          if tag["id"] == spatial_tag_id do
            Map.merge(tag, %{
              "trust_score" => new_trust_score,
              "verification_status" => determine_verification_status(new_trust_score, verifications)
            })
          else
            tag
          end
        end)

        # Update the image with new spatial tags
        NukeApi.Vehicles.update_image(image, %{"spatial_tags" => updated_tags})

      nil ->
        {:error, :image_not_found}
    end
  end

  @doc """
  Calculates trust score based on verifications.
  """
  def calculate_trust_score(verifications) do
    base_score = 10

    # Sum up all trust score impacts
    total_impact = Enum.reduce(verifications, 0, fn verification, acc ->
      acc + verification.trust_score_impact
    end)

    # Apply logarithmic scaling for diminishing returns
    scaled_impact = if total_impact > 0 do
      :math.log(1 + total_impact) * 10
    else
      total_impact * 0.5  # Negative impacts are less scaled
    end

    # Final score between 0 and 100
    final_score = base_score + scaled_impact
    max(0, min(100, round(final_score)))
  end

  # =====================================================================================
  # VERIFICATION WORKFLOW HELPERS
  # =====================================================================================

  @doc """
  Verifies a spatial tag with automatic expertise detection.
  """
  def verify_spatial_tag(image_id, spatial_tag_id, verifier_user_id, action, opts \\ []) do
    # Determine verifier type based on user expertise and context
    verifier_type = determine_verifier_type(verifier_user_id, opts)

    case verifier_type do
      "professional" ->
        create_professional_verification(image_id, spatial_tag_id, verifier_user_id, action, opts)

      "brand_representative" ->
        create_brand_verification(image_id, spatial_tag_id, verifier_user_id, action, opts)

      _ ->
        create_peer_verification(image_id, spatial_tag_id, verifier_user_id, action, opts)
    end
  end

  @doc """
  Gets verification summary for dashboard/analytics.
  """
  def get_verification_summary(date_range \\ nil) do
    base_query = TagVerification

    query = if date_range do
      from(tv in base_query,
        where: tv.created_at >= ^date_range.start and tv.created_at <= ^date_range.end
      )
    else
      base_query
    end

    # Total verifications
    total_verifications = Repo.aggregate(query, :count)

    # Verifications by type
    verifications_by_type = from(tv in query,
      group_by: tv.verifier_type,
      select: {tv.verifier_type, count()}
    ) |> Repo.all() |> Enum.into(%{})

    # Verifications by action
    verifications_by_action = from(tv in query,
      group_by: tv.action,
      select: {tv.action, count()}
    ) |> Repo.all() |> Enum.into(%{})

    # Average trust impact
    avg_trust_impact = from(tv in query,
      select: avg(tv.trust_score_impact)
    ) |> Repo.one() || 0

    %{
      total_verifications: total_verifications,
      verifications_by_type: verifications_by_type,
      verifications_by_action: verifications_by_action,
      average_trust_impact: avg_trust_impact
    }
  end

  # =====================================================================================
  # PRIVATE HELPER FUNCTIONS
  # =====================================================================================

  defp determine_verifier_type(user_id, opts) do
    cond do
      opts[:brand_id] && opts[:brand_representative] -> "brand_representative"
      opts[:professional_credentials] -> "professional"
      has_professional_expertise?(user_id) -> "professional"
      true -> "peer"
    end
  end

  defp has_professional_expertise?(user_id) do
    from(ue in UserExpertise,
      where: ue.user_id == ^user_id and ue.expertise_level == "professional",
      select: count()
    )
    |> Repo.one()
    |> Kernel.>(0)
  end

  defp determine_verification_status(trust_score, verifications) do
    dispute_count = Enum.count(verifications, &(&1.action == "dispute"))

    cond do
      trust_score >= 70 -> "verified"
      dispute_count > 2 -> "disputed"
      trust_score <= 20 -> "rejected"
      true -> "pending"
    end
  end

  defp update_brand_tag_verification(image_id, spatial_tag_id, brand_id, action) when not is_nil(brand_id) do
    # Update brand tag verification status
    case Brands.list_brand_tags_for_image(image_id) do
      brand_tags ->
        Enum.each(brand_tags, fn brand_tag ->
          if brand_tag.spatial_tag_id == spatial_tag_id and brand_tag.brand_id == brand_id do
            verification_status = case action do
              "verify" -> "verified"
              "dispute" -> "disputed"
              _ -> brand_tag.verification_status
            end

            Brands.verify_brand_tag(brand_tag, nil, verification_status)
          end
        end)
    end
  end
  defp update_brand_tag_verification(_, _, _, _), do: :ok
end