defmodule NukeApi.Mailbox.MailboxMessage do
  use Ecto.Schema
  import Ecto.Changeset

  alias NukeApi.Mailbox.VehicleMailbox
  alias NukeApi.Accounts.User

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @message_types [
    "duplicate_detected",
    "ownership_transfer",
    "service_reminder",
    "insurance_claim",
    "recall_notice",
    "registration_due",
    "inspection_due",
    "system_alert"
  ]

  @priority_levels ["low", "medium", "high", "urgent"]
  @sender_types ["user", "system", "organization"]

  schema "mailbox_messages" do
    field :message_type, :string
    field :title, :string
    field :content, :string
    field :priority, :string, default: "medium"
    field :sender_type, :string, default: "system"
    field :metadata, :map
    field :read_by, {:array, :binary_id}, default: []
    field :resolved_at, :utc_datetime
    field :resolved_by, :binary_id

    belongs_to :mailbox, VehicleMailbox
    belongs_to :sender, User, foreign_key: :sender_id

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(mailbox_message, attrs) do
    mailbox_message
    |> cast(attrs, [
      :mailbox_id,
      :message_type,
      :title,
      :content,
      :priority,
      :sender_id,
      :sender_type,
      :metadata,
      :read_by,
      :resolved_at,
      :resolved_by
    ])
    |> validate_required([:mailbox_id, :message_type, :title])
    |> validate_inclusion(:message_type, @message_types)
    |> validate_inclusion(:priority, @priority_levels)
    |> validate_inclusion(:sender_type, @sender_types)
    |> validate_length(:title, max: 200)
    |> foreign_key_constraint(:mailbox_id)
    |> foreign_key_constraint(:sender_id)
  end

  def message_types, do: @message_types
  def priority_levels, do: @priority_levels
  def sender_types, do: @sender_types
end