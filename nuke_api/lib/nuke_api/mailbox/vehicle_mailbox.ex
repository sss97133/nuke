defmodule NukeApi.Mailbox.VehicleMailbox do
  use Ecto.Schema
  import Ecto.Changeset

  alias NukeApi.Vehicles.Vehicle
  alias NukeApi.Mailbox.{MailboxMessage, MailboxAccessKey}

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "vehicle_mailboxes" do
    field :vin, :string

    belongs_to :vehicle, Vehicle
    has_many :messages, MailboxMessage, foreign_key: :mailbox_id
    has_many :access_keys, MailboxAccessKey, foreign_key: :mailbox_id

    # Virtual fields for API responses
    field :user_access_level, :string, virtual: true
    field :unread_count, :integer, virtual: true

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(vehicle_mailbox, attrs) do
    vehicle_mailbox
    |> cast(attrs, [:vehicle_id, :vin])
    |> validate_required([:vehicle_id, :vin])
    |> validate_length(:vin, is: 17)
    |> unique_constraint(:vehicle_id)
    |> unique_constraint(:vin)
    |> foreign_key_constraint(:vehicle_id)
  end
end