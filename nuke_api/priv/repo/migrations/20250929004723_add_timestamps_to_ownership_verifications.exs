defmodule NukeApi.Repo.Migrations.AddTimestampsToOwnershipVerifications do
  use Ecto.Migration

  def change do
    alter table(:ownership_verifications) do
      add :inserted_at, :naive_datetime, null: false, default: fragment("NOW()")
    end
  end
end
