defmodule NukeApi.Vehicles.Document do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "vehicle_documents" do
    field :document_type, :string
    field :title, :string
    field :description, :string
    field :document_date, :utc_datetime

    # File information
    field :file_url, :string
    field :file_name, :string
    field :file_type, :string
    field :file_size, :integer

    # Privacy and security
    field :privacy_level, :string, default: "owner_only"
    field :contains_pii, :boolean, default: true
    field :pii_redacted_url, :string

    # AI/ML extracted data
    field :extracted_data, :map, default: %{}

    # Business data extracted from documents
    field :vendor_name, :string
    field :amount, :decimal
    field :currency, :string, default: "USD"
    field :parts_ordered, {:array, :string}, default: []
    field :service_performed, :string

    # Timeline integration
    field :timeline_event_created, :boolean, default: false

    # User tracking
    field :uploaded_by, :binary_id

    belongs_to :vehicle, NukeApi.Vehicles.Vehicle
    belongs_to :timeline_event, NukeApi.Vehicles.Timeline, foreign_key: :timeline_event_id

    timestamps()
  end

  @doc false
  def changeset(document, attrs) do
    document
    |> cast(attrs, [
      :vehicle_id, :document_type, :title, :description, :document_date,
      :file_url, :file_name, :file_type, :file_size, :privacy_level,
      :contains_pii, :pii_redacted_url, :extracted_data, :vendor_name,
      :amount, :currency, :parts_ordered, :service_performed,
      :timeline_event_created, :timeline_event_id, :uploaded_by
    ])
    |> validate_required([:vehicle_id, :document_type, :title, :file_url, :file_name, :file_type])
    |> validate_inclusion(:document_type, [
      "title", "registration", "insurance", "receipt", "service_record",
      "inspection", "warranty", "manual", "other"
    ])
    |> validate_inclusion(:privacy_level, ["owner_only", "public", "verified_only"])
    |> validate_number(:file_size, greater_than: 0)
    |> foreign_key_constraint(:vehicle_id)
    |> foreign_key_constraint(:timeline_event_id)
  end
end