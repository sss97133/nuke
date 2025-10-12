defmodule NukeApi.Brands.BrandAlias do
  @moduledoc """
  Schema for BrandAlias - alternative names and spellings for brands.

  Helps with matching user-generated tags to official brands.
  Examples: "Chevy" -> "Chevrolet", "Snapon" -> "Snap-on"
  """

  use Ecto.Schema
  import Ecto.Changeset
  alias NukeApi.Brands.Brand

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "brand_aliases" do
    field :alias_name, :string
    field :alias_type, :string, default: "common"

    belongs_to :brand, Brand

    timestamps(inserted_at: :created_at, updated_at: false)
  end

  @required_fields ~w(brand_id alias_name)a
  @optional_fields ~w(alias_type)a

  @alias_types [
    "common", "misspelling", "abbreviation", "legacy", "trademark"
  ]

  @doc """
  Creates a changeset for a brand alias.
  """
  def changeset(alias, attrs) do
    alias
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:alias_type, @alias_types)
    |> foreign_key_constraint(:brand_id)
    |> unique_constraint([:brand_id, :alias_name])
    |> validate_length(:alias_name, min: 1, max: 100)
  end

  @doc """
  Finds a brand by alias name (case-insensitive).
  """
  def find_brand_by_alias(query \\ __MODULE__, alias_name) do
    import Ecto.Query

    query
    |> join(:inner, [a], b in Brand, on: a.brand_id == b.id)
    |> where([a], ilike(a.alias_name, ^alias_name))
    |> select([a, b], b)
  end
end