defmodule NukeApi.WorkOrders.WorkOrderProof do
  @moduledoc """
  Work order proof artifacts (public.work_order_proofs).
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias NukeApi.WorkOrders.WorkOrder
  alias NukeApi.Accounts.User
  alias NukeApi.Vehicles.Vehicle

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "work_order_proofs" do
    belongs_to :work_order, WorkOrder, foreign_key: :work_order_id
    belongs_to :vehicle, Vehicle
    belongs_to :uploaded_by_user, User, foreign_key: :uploaded_by

    field :proof_type, :string
    field :urls, {:array, :string}, default: []
    field :notes, :string
    field :metadata, :map, default: %{}

    timestamps(inserted_at: :created_at, updated_at: false, type: :utc_datetime)
  end

  @types ["before_photos", "after_photos", "timelapse", "receipt", "note", "other"]

  def changeset(proof, attrs) do
    proof
    |> cast(attrs, [:work_order_id, :vehicle_id, :uploaded_by, :proof_type, :urls, :notes, :metadata])
    |> validate_required([:work_order_id, :proof_type])
    |> validate_inclusion(:proof_type, @types)
    |> foreign_key_constraint(:work_order_id)
    |> foreign_key_constraint(:vehicle_id)
    |> foreign_key_constraint(:uploaded_by)
  end
end


