defmodule NukeApi.Vehicles.ImageTags do
  @moduledoc """
  Context for managing image tags stored in the database.
  """

  import Ecto.Query, warn: false
  alias NukeApi.Repo
  alias NukeApi.Vehicles.ImageTag

  @doc """
  Returns the list of image tags for a specific image.
  """
  def list_image_tags(image_id) do
    from(t in ImageTag, where: t.image_id == ^image_id, order_by: [desc: t.inserted_at])
    |> Repo.all()
  end

  @doc """
  Gets a single image tag.
  """
  def get_image_tag!(id), do: Repo.get!(ImageTag, id)
  def get_image_tag(id), do: Repo.get(ImageTag, id)

  @doc """
  Creates an image tag.
  """
  def create_image_tag(attrs \\ %{}) do
    %ImageTag{}
    |> ImageTag.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Updates an image tag.
  """
  def update_image_tag(%ImageTag{} = image_tag, attrs) do
    image_tag
    |> ImageTag.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Deletes an image tag.
  """
  def delete_image_tag(%ImageTag{} = image_tag) do
    Repo.delete(image_tag)
  end

  @doc """
  Returns an `%Ecto.Changeset{}` for tracking image tag changes.
  """
  def change_image_tag(%ImageTag{} = image_tag, attrs \\ %{}) do
    ImageTag.changeset(image_tag, attrs)
  end

  @doc """
  Gets tag statistics for an image.
  """
  def get_image_tag_stats(image_id) do
    from(t in ImageTag, where: t.image_id == ^image_id)
    |> Repo.aggregate(:count, :id)
  end

  @doc """
  Gets tags by type for an image.
  """
  def list_tags_by_type(image_id, tag_type) do
    from(t in ImageTag,
      where: t.image_id == ^image_id and t.tag_type == ^tag_type,
      order_by: [desc: t.trust_score, desc: t.inserted_at]
    )
    |> Repo.all()
  end

  @doc """
  Gets tags within a coordinate range.
  """
  def list_tags_in_area(image_id, x_min, y_min, x_max, y_max) do
    from(t in ImageTag,
      where: t.image_id == ^image_id and
             t.x_position >= ^x_min and t.x_position <= ^x_max and
             t.y_position >= ^y_min and t.y_position <= ^y_max
    )
    |> Repo.all()
  end

  @doc """
  Verifies a tag by updating its verification status and trust score.
  """
  def verify_tag(%ImageTag{} = tag, verifier_id, verification_type \\ "peer") do
    trust_increment = case verification_type do
      "professional" -> 25
      "expert" -> 15
      "peer" -> 10
      _ -> 5
    end

    new_trust_score = min(tag.trust_score + trust_increment, 100)

    attrs = %{
      verification_status: "verified",
      trust_score: new_trust_score,
      verified_by: verifier_id,
      verified_at: DateTime.utc_now()
    }

    update_image_tag(tag, attrs)
  end

  @doc """
  Disputes a tag by updating its verification status.
  """
  def dispute_tag(%ImageTag{} = tag, disputer_id) do
    attrs = %{
      verification_status: "disputed",
      trust_score: max(tag.trust_score - 15, 0),
      metadata: Map.put(tag.metadata || %{}, "disputed_by", disputer_id)
    }

    update_image_tag(tag, attrs)
  end
end