defmodule NukeApi.Repo.Migrations.CreateOwnershipVerifications do
  use Ecto.Migration

  def change do
    create table(:ownership_verifications, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :vehicle_id, references(:vehicles, on_delete: :delete_all, type: :binary_id), null: false
      add :user_id, references(:profiles, on_delete: :delete_all, type: :binary_id), null: false
      add :status, :string, null: false, default: "pending" # pending, approved, rejected, expired
      add :verification_type, :string, null: false, default: "title" # title, registration, bill_of_sale, insurance, previous_owner
      add :title_document_url, :string
      add :drivers_license_url, :string
      add :insurance_document_url, :string
      add :registration_document_url, :string
      add :bill_of_sale_url, :string
      add :supporting_documents, :map, default: %{}
      add :extracted_data, :map, default: %{}
      add :admin_notes, :text
      add :rejection_reason, :string
      add :submitted_at, :utc_datetime, null: false
      add :reviewed_at, :utc_datetime
      add :reviewed_by, references(:profiles, type: :binary_id)
      add :expires_at, :utc_datetime
      add :metadata, :map, default: %{}

      timestamps()
    end

    create index(:ownership_verifications, [:vehicle_id])
    create index(:ownership_verifications, [:user_id])
    create index(:ownership_verifications, [:status])
    create index(:ownership_verifications, [:verification_type])
    create index(:ownership_verifications, [:submitted_at])
    create unique_index(:ownership_verifications, [:vehicle_id, :user_id], where: "status = 'approved'")
  end
end