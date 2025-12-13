defmodule NukeApi.WorkOrders.WorkOrderQuote do
  @moduledoc """
  Work order quote schema (public.work_order_quotes).
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias NukeApi.Accounts.User
  alias NukeApi.WorkOrders.WorkOrder

  @derive {Jason.Encoder,
           only: [
             :id,
             :work_order_id,
             :business_id,
             :created_by,
             :amount_cents,
             :currency,
             :estimated_hours,
             :labor_cents,
             :parts_cents,
             :notes,
             :metadata,
             :status,
             :created_at,
             :updated_at
           ]}

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "work_order_quotes" do
    belongs_to :work_order, WorkOrder, foreign_key: :work_order_id

    # Optional: which business produced this quote (supabase references public.businesses)
    field :business_id, :binary_id
    belongs_to :created_by_user, User, foreign_key: :created_by

    field :amount_cents, :integer
    field :currency, :string, default: "USD"
    field :estimated_hours, :decimal
    field :labor_cents, :integer
    field :parts_cents, :integer
    field :notes, :string
    field :metadata, :map, default: %{}
    field :status, :string, default: "sent"

    timestamps(inserted_at: :created_at, updated_at: :updated_at, type: :utc_datetime)
  end

  @statuses ["draft", "sent", "accepted", "rejected", "withdrawn"]

  def changeset(quote, attrs) do
    quote
    |> cast(attrs, [
      :work_order_id,
      :business_id,
      :created_by,
      :amount_cents,
      :currency,
      :estimated_hours,
      :labor_cents,
      :parts_cents,
      :notes,
      :metadata,
      :status
    ])
    |> validate_required([:work_order_id, :amount_cents, :currency, :status])
    |> validate_number(:amount_cents, greater_than: 0)
    |> validate_inclusion(:status, @statuses)
    |> foreign_key_constraint(:work_order_id)
    |> foreign_key_constraint(:created_by)
  end
end


