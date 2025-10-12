defmodule NukeApi.Repo.Migrations.AddMissingOwnershipVerificationColumns do
  use Ecto.Migration

  def change do
    alter table(:ownership_verifications) do
      add :registration_document_url, :varchar
      add :bill_of_sale_url, :varchar
      add :supporting_documents, :jsonb, default: "{}"
      add :admin_notes, :text
      add :reviewed_at, :timestamptz
      add :metadata, :jsonb, default: "{}"
      add :reviewed_by, :uuid
    end
  end
end
