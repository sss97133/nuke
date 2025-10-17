defmodule NukeApi.MarketData.ListingMonitor do
  @moduledoc """
  Tracks an external listing URL for a given vehicle and monitors status changes.
  Backed by `listing_monitors` table in Supabase.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "listing_monitors" do
    field :vehicle_id, :binary_id
    field :source_url, :string
    field :source_platform, :string
    field :status, :string, default: "active"
    field :last_checked, :utc_datetime
    field :last_status, :string
    field :last_content_hash, :string
    field :sale_detected_at, :utc_datetime
    field :final_sale_price, :decimal
    field :sale_date, :date
    field :created_by, :binary_id
    field :metadata, :map, default: %{}
    field :created_at, :utc_datetime
    field :updated_at, :utc_datetime

    timestamps(updated_at: :updated_at, inserted_at: :created_at, type: :utc_datetime)
  end

  @doc false
  def changeset(monitor, attrs) do
    monitor
    |> cast(attrs, [
      :vehicle_id,
      :source_url,
      :source_platform,
      :status,
      :last_checked,
      :last_status,
      :last_content_hash,
      :sale_detected_at,
      :final_sale_price,
      :sale_date,
      :created_by,
      :metadata
    ])
    |> validate_required([:vehicle_id, :source_url])
  end
end
