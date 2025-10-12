defmodule NukeApi.Repo.Migrations.CreateVehicleDocuments do
  use Ecto.Migration

  def change do
    create table(:vehicle_documents, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :vehicle_id, references(:vehicles, on_delete: :delete_all, type: :binary_id), null: false

      # Document classification
      add :document_type, :string, null: false
      add :title, :string, null: false
      add :description, :text
      add :document_date, :utc_datetime

      # File information
      add :file_url, :string, null: false
      add :file_name, :string, null: false
      add :file_type, :string, null: false
      add :file_size, :bigint

      # Privacy and security
      add :privacy_level, :string, null: false, default: "owner_only"
      add :contains_pii, :boolean, null: false, default: true
      add :pii_redacted_url, :string

      # AI/ML extracted data
      add :extracted_data, :map, default: %{}

      # Business data extracted from documents
      add :vendor_name, :string
      add :amount, :decimal, precision: 15, scale: 2
      add :currency, :string, default: "USD"
      add :parts_ordered, {:array, :string}, default: []
      add :service_performed, :text

      # Timeline integration
      add :timeline_event_created, :boolean, default: false
      add :timeline_event_id, references(:vehicle_timeline, type: :binary_id, on_delete: :nilify_all)

      # User tracking
      add :uploaded_by, :binary_id

      timestamps()
    end

    create index(:vehicle_documents, [:vehicle_id])
    create index(:vehicle_documents, [:document_type])
    create index(:vehicle_documents, [:privacy_level])
    create index(:vehicle_documents, [:timeline_event_id])
    create index(:vehicle_documents, [:uploaded_by])
    create index(:vehicle_documents, [:document_date])
    create index(:vehicle_documents, [:vendor_name])
  end
end