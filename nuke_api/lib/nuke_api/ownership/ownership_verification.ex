defmodule NukeApi.Ownership.OwnershipVerification do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "ownership_verifications" do
    field :user_id, :binary_id
    field :status, :string, default: "pending"
    field :verification_type, :string, default: "title"
    field :title_document_url, :string
    field :drivers_license_url, :string
    field :insurance_document_url, :string
    field :registration_document_url, :string
    field :bill_of_sale_url, :string
    field :supporting_documents, :map, default: %{}
    field :extracted_data, :map, default: %{}
    field :admin_notes, :string
    field :rejection_reason, :string
    field :submitted_at, :utc_datetime
    field :reviewed_at, :utc_datetime
    field :reviewed_by, :binary_id
    field :expires_at, :utc_datetime
    field :metadata, :map, default: %{}

    belongs_to :vehicle, NukeApi.Vehicles.Vehicle

    timestamps()
  end

  @doc false
  def changeset(verification, attrs) do
    verification
    |> cast(attrs, [
      :user_id, :vehicle_id, :status, :verification_type, :title_document_url,
      :drivers_license_url, :insurance_document_url, :registration_document_url,
      :bill_of_sale_url, :supporting_documents, :extracted_data, :admin_notes,
      :rejection_reason, :submitted_at, :reviewed_at, :reviewed_by, :expires_at, :metadata
    ])
    |> validate_required([:user_id, :vehicle_id, :status, :submitted_at])
    |> validate_inclusion(:status, ["pending", "approved", "rejected", "expired"])
    |> validate_inclusion(:verification_type, ["title", "registration", "bill_of_sale", "insurance", "previous_owner"])
    |> foreign_key_constraint(:vehicle_id)
    |> foreign_key_constraint(:user_id)
    |> unique_constraint([:user_id, :vehicle_id], name: :ownership_verifications_user_id_vehicle_id_key)
  end
end