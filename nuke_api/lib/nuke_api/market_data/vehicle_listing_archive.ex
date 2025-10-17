defmodule NukeApi.MarketData.VehicleListingArchive do
  @moduledoc """
  Snapshot of an external marketplace listing associated to a `vehicle_id`.
  Backed by the `vehicle_listing_archives` table (managed in Supabase).
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "vehicle_listing_archives" do
    field :vehicle_id, :binary_id
    field :source_platform, :string
    field :source_url, :string
    field :listing_status, :string
    field :final_sale_price, :decimal
    field :sale_date, :date
    field :html_content, :string
    field :description_text, :string
    field :images, :map
    field :metadata, :map, default: %{}
    field :scraped_at, :utc_datetime
    field :created_at, :utc_datetime
  end

  @doc false
  def changeset(archive, attrs) do
    archive
    |> cast(attrs, [
      :vehicle_id,
      :source_platform,
      :source_url,
      :listing_status,
      :final_sale_price,
      :sale_date,
      :html_content,
      :description_text,
      :images,
      :metadata,
      :scraped_at,
      :created_at
    ])
    |> validate_required([:vehicle_id, :source_platform, :source_url])
  end
end
