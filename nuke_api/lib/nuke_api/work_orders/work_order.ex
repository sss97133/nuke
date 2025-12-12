defmodule NukeApi.WorkOrders.WorkOrder do
  @moduledoc """
  Work Order schema.

  NOTE: This table is created/managed by Supabase SQL migrations (public.work_orders).
  Phoenix uses this schema to write/read work-order drafts as part of the mailbox workflow.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias NukeApi.Accounts.User
  alias NukeApi.Vehicles.Vehicle
  alias NukeApi.Organizations.Organization

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "work_orders" do
    # Where the request is routed (nullable for early draft)
    belongs_to :organization, Organization, foreign_key: :organization_id

    # Who requested it
    belongs_to :customer, User, foreign_key: :customer_id
    field :customer_name, :string
    field :customer_phone, :string
    field :customer_email, :string

    # Vehicle
    belongs_to :vehicle, Vehicle

    # What it is
    field :title, :string
    field :description, :string
    field :urgency, :string, default: "normal"

    # Attachments
    field :images, {:array, :string}, default: []

    # Estimates + actuals (optional)
    field :estimated_hours, :decimal
    field :estimated_labor_cost, :decimal
    field :actual_hours, :decimal

    # Source + workflow
    field :request_source, :string, default: "mailbox"
    field :status, :string, default: "draft"

    field :metadata, :map, default: %{}

    # Supabase migrations use created_at/updated_at
    timestamps(inserted_at: :created_at, updated_at: :updated_at, type: :utc_datetime)
  end

  @urgencies ["low", "normal", "high", "emergency"]
  @request_sources ["web", "sms", "phone", "email", "mailbox", "system"]
  @statuses ["draft", "pending", "quoted", "approved", "scheduled", "in_progress", "completed", "paid", "cancelled"]

  @doc false
  def changeset(work_order, attrs) do
    work_order
    |> cast(attrs, [
      :organization_id,
      :customer_id,
      :customer_name,
      :customer_phone,
      :customer_email,
      :vehicle_id,
      :title,
      :description,
      :urgency,
      :images,
      :estimated_hours,
      :estimated_labor_cost,
      :actual_hours,
      :request_source,
      :status,
      :metadata
    ])
    |> validate_required([:title, :description])
    |> validate_inclusion(:urgency, @urgencies)
    |> validate_inclusion(:request_source, @request_sources)
    |> validate_inclusion(:status, @statuses)
    |> validate_length(:title, max: 200)
    |> foreign_key_constraint(:organization_id)
    |> foreign_key_constraint(:customer_id)
    |> foreign_key_constraint(:vehicle_id)
  end
end


