defmodule NukeApi.Brands.Brand do
  @moduledoc """
  Schema for Brand - represents companies/manufacturers for corporate claiming system.

  Brands can claim their tags across the platform for analytics and data harvesting.
  Examples: Chevrolet claiming all tagged Chevy vehicles, Snap-on claiming tool tags.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "brands" do
    field :name, :string
    field :slug, :string
    field :industry, :string
    field :category, :string
    field :description, :string
    field :logo_url, :string
    field :website_url, :string

    # Corporate verification
    field :verification_status, :string, default: "pending"
    field :verification_contact, :string
    field :verification_documents, {:array, :string}, default: []

    # Claiming information
    field :claimed_at, :utc_datetime
    field :claimed_by, :binary_id
    field :claim_notes, :string

    # Analytics
    field :total_tags, :integer, default: 0
    field :total_verified_tags, :integer, default: 0
    field :first_tagged_at, :utc_datetime
    field :last_tagged_at, :utc_datetime

    timestamps()
  end

  @required_fields ~w(name slug industry)a
  @optional_fields ~w(
    category description logo_url website_url verification_status
    verification_contact verification_documents claimed_at claimed_by claim_notes
    total_tags total_verified_tags first_tagged_at last_tagged_at
  )a

  @industries [
    "automotive", "tools", "welding", "parts", "fluids", "equipment",
    "service_provider", "retailer", "manufacturer", "other"
  ]

  @categories [
    "manufacturer", "retailer", "service_provider", "distributor", "other"
  ]

  @verification_statuses [
    "pending", "verified", "disputed"
  ]

  @doc """
  Creates a changeset for a brand.
  """
  def changeset(brand, attrs) do
    brand
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:industry, @industries)
    |> validate_inclusion(:category, @categories)
    |> validate_inclusion(:verification_status, @verification_statuses)
    |> validate_format(:slug, ~r/^[a-z0-9-]+$/, message: "must contain only lowercase letters, numbers, and dashes")
    |> unique_constraint(:name)
    |> unique_constraint(:slug)
    |> generate_slug()
  end

  @doc """
  Creates a changeset for claiming a brand.
  """
  def claim_changeset(brand, claimer_user_id, claim_notes \\ "") do
    brand
    |> change(%{
      claimed_at: DateTime.utc_now(),
      claimed_by: claimer_user_id,
      claim_notes: claim_notes,
      verification_status: "pending"
    })
  end

  @doc """
  Creates a changeset for verifying a brand claim.
  """
  def verify_changeset(brand, verification_status, verification_contact \\ nil) do
    attrs = %{verification_status: verification_status}
    attrs = if verification_contact, do: Map.put(attrs, :verification_contact, verification_contact), else: attrs

    brand
    |> change(attrs)
    |> validate_inclusion(:verification_status, @verification_statuses)
  end

  # Private helper to generate slug if not provided
  defp generate_slug(changeset) do
    case get_change(changeset, :slug) do
      nil ->
        case get_change(changeset, :name) do
          nil -> changeset
          name ->
            slug = name
                   |> String.downcase()
                   |> String.replace(~r/[^a-z0-9\s-]/, "")
                   |> String.replace(~r/\s+/, "-")
                   |> String.trim("-")
            put_change(changeset, :slug, slug)
        end
      _ ->
        changeset
    end
  end
end