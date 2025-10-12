defmodule NukeApi.Verification.TagVerification do
  @moduledoc """
  Schema for TagVerification - tracks who verified/disputed each spatial tag.

  This implements the multi-level verification system with weighted trust scoring.
  Professional mechanics, brand representatives, and repeat verifiers have higher weight.
  """

  use Ecto.Schema
  import Ecto.Changeset
  alias NukeApi.Vehicles.Image

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "tag_verifications" do
    field :spatial_tag_id, :string
    field :verifier_type, :string
    field :action, :string
    field :verification_data, :map, default: %{}

    # Trust scoring
    field :trust_weight, :integer, default: 1
    field :trust_score_impact, :integer, default: 0

    # Professional verification details
    field :professional_title, :string
    field :professional_credentials, {:array, :string}, default: []
    field :organization, :string

    belongs_to :image, Image, foreign_key: :image_id
    field :verifier_user_id, :binary_id

    timestamps(inserted_at: :created_at, updated_at: false)
  end

  @required_fields ~w(image_id spatial_tag_id verifier_user_id verifier_type action)a
  @optional_fields ~w(
    verification_data trust_weight trust_score_impact professional_title
    professional_credentials organization
  )a

  @verifier_types [
    "owner", "peer", "professional", "brand_representative", "ai_system"
  ]

  @actions [
    "verify", "dispute", "correct", "flag"
  ]

  @doc """
  Creates a changeset for a tag verification.
  """
  def changeset(verification, attrs) do
    verification
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:verifier_type, @verifier_types)
    |> validate_inclusion(:action, @actions)
    |> validate_number(:trust_weight, greater_than: 0, less_than_or_equal_to: 10)
    |> foreign_key_constraint(:image_id)
    |> set_trust_weight_based_on_type()
    |> calculate_trust_score_impact()
  end

  @doc """
  Creates a verification for a peer user.
  """
  def peer_verification_changeset(image_id, spatial_tag_id, verifier_user_id, action, opts \\ []) do
    attrs = %{
      image_id: image_id,
      spatial_tag_id: spatial_tag_id,
      verifier_user_id: verifier_user_id,
      verifier_type: "peer",
      action: action,
      verification_data: opts[:data] || %{}
    }

    %__MODULE__{}
    |> changeset(attrs)
  end

  @doc """
  Creates a verification for a professional.
  """
  def professional_verification_changeset(image_id, spatial_tag_id, verifier_user_id, action, opts) do
    attrs = %{
      image_id: image_id,
      spatial_tag_id: spatial_tag_id,
      verifier_user_id: verifier_user_id,
      verifier_type: "professional",
      action: action,
      professional_title: opts[:title],
      professional_credentials: opts[:credentials] || [],
      organization: opts[:organization],
      verification_data: opts[:data] || %{}
    }

    %__MODULE__{}
    |> changeset(attrs)
  end

  @doc """
  Creates a verification for a brand representative.
  """
  def brand_verification_changeset(image_id, spatial_tag_id, verifier_user_id, action, opts) do
    attrs = %{
      image_id: image_id,
      spatial_tag_id: spatial_tag_id,
      verifier_user_id: verifier_user_id,
      verifier_type: "brand_representative",
      action: action,
      organization: opts[:brand_name],
      verification_data: Map.merge(opts[:data] || %{}, %{
        brand_id: opts[:brand_id],
        representative_role: opts[:role]
      })
    }

    %__MODULE__{}
    |> changeset(attrs)
  end

  # Private helper to set trust weight based on verifier type
  defp set_trust_weight_based_on_type(changeset) do
    case get_change(changeset, :verifier_type) do
      "owner" -> put_change(changeset, :trust_weight, 2)
      "peer" -> put_change(changeset, :trust_weight, 1)
      "professional" -> put_change(changeset, :trust_weight, 4)
      "brand_representative" -> put_change(changeset, :trust_weight, 5)
      "ai_system" -> put_change(changeset, :trust_weight, 2)
      _ -> changeset
    end
  end

  # Private helper to calculate trust score impact
  defp calculate_trust_score_impact(changeset) do
    action = get_change(changeset, :action)
    trust_weight = get_change(changeset, :trust_weight) || 1

    impact = case action do
      "verify" -> trust_weight * 10  # Positive impact
      "dispute" -> trust_weight * -15 # Negative impact
      "correct" -> trust_weight * 5   # Small positive (correction)
      "flag" -> trust_weight * -5     # Small negative
      _ -> 0
    end

    put_change(changeset, :trust_score_impact, impact)
  end
end