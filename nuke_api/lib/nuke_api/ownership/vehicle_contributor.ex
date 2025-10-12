defmodule NukeApi.Ownership.VehicleContributor do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "vehicle_contributors" do
    field :role, :string
    field :status, :string, default: "active"
    field :contribution_summary, :string
    field :start_date, :date
    field :end_date, :date
    field :verified, :boolean, default: false
    field :verified_at, :utc_datetime
    field :metadata, :map, default: %{}

    belongs_to :vehicle, NukeApi.Vehicles.Vehicle
    belongs_to :user, NukeApi.Accounts.Profile, foreign_key: :user_id
    belongs_to :verified_by_profile, NukeApi.Accounts.Profile, foreign_key: :verified_by

    timestamps()
  end

  @doc false
  def changeset(contributor, attrs) do
    contributor
    |> cast(attrs, [
      :vehicle_id, :user_id, :role, :status, :contribution_summary,
      :start_date, :end_date, :verified, :verified_at, :verified_by, :metadata
    ])
    |> validate_required([:vehicle_id, :user_id, :role, :status])
    |> validate_inclusion(:role, ["owner", "previous_owner", "restorer", "contributor", "mechanic"])
    |> validate_inclusion(:status, ["active", "inactive", "pending"])
    |> foreign_key_constraint(:vehicle_id)
    |> foreign_key_constraint(:user_id)
    |> unique_constraint([:vehicle_id, :user_id, :role])
  end
end