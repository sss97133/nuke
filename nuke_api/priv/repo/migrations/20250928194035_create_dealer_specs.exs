defmodule NukeApi.Repo.Migrations.CreateDealerSpecs do
  use Ecto.Migration

  def change do
    create table(:dealer_specs, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :vehicle_id, references(:vehicles, on_delete: :delete_all, type: :binary_id), null: false
      add :dealer_name, :string
      add :dealer_location, :string
      add :purchase_date, :date
      add :purchase_price, :decimal, precision: 10, scale: 2
      add :original_msrp, :decimal, precision: 10, scale: 2
      add :mileage_at_purchase, :integer
      add :condition_at_purchase, :string
      add :warranty_info, :text
      add :financing_details, :text
      add :trade_in_details, :text
      add :purchase_notes, :text
      add :confidence_score, :float, default: 0.0
      add :extraction_source, :string # "image", "manual", "import"
      add :verification_status, :string, default: "unverified" # "unverified", "verified", "disputed"

      timestamps(type: :naive_datetime)
    end

    create index(:dealer_specs, [:vehicle_id])
    create index(:dealer_specs, [:dealer_name])
    create index(:dealer_specs, [:purchase_date])
    create index(:dealer_specs, [:verification_status])
  end
end