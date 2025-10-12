defmodule NukeApi.Repo.Migrations.SeparateUploaderFromOwner do
  use Ecto.Migration

  def change do
    # Rename user_id to uploaded_by to clarify it's not ownership
    rename table(:vehicles), :user_id, to: :uploaded_by

    # Add new fields to track the upload/import context
    alter table(:vehicles) do
      add :import_source, :string  # 'manual', 'batch_import', 'api', etc.
      add :import_metadata, :map   # Additional context about how this was imported
      add :uploaded_at, :utc_datetime, default: fragment("NOW()")
    end
  end
end
