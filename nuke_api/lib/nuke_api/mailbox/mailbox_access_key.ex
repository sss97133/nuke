defmodule NukeApi.Mailbox.MailboxAccessKey do
  use Ecto.Schema
  import Ecto.Changeset

  alias NukeApi.Mailbox.VehicleMailbox
  alias NukeApi.Accounts.User
  alias NukeApi.Organizations.Organization

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @key_types ["master", "temporary", "conditional", "inherited", "system"]
  @permission_levels ["read_write", "read_only", "write_only", "filtered"]
  @relationship_types [
    "owner",
    "dealer",
    "service_provider",
    "insurance",
    "financing",
    "family",
    "trusted_party"
  ]

  schema "mailbox_access_keys" do
    field :key_type, :string
    field :permission_level, :string
    field :relationship_type, :string
    field :expires_at, :utc_datetime
    field :conditions, :map

    belongs_to :mailbox, VehicleMailbox
    belongs_to :user, User
    belongs_to :org, Organization
    belongs_to :granted_by, User, foreign_key: :granted_by

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(mailbox_access_key, attrs) do
    mailbox_access_key
    |> cast(attrs, [
      :mailbox_id,
      :user_id,
      :org_id,
      :key_type,
      :permission_level,
      :relationship_type,
      :granted_by,
      :expires_at,
      :conditions
    ])
    |> validate_required([:mailbox_id, :key_type, :permission_level, :relationship_type])
    |> validate_inclusion(:key_type, @key_types)
    |> validate_inclusion(:permission_level, @permission_levels)
    |> validate_inclusion(:relationship_type, @relationship_types)
    |> validate_user_or_org_present()
    |> unique_constraint([:mailbox_id, :user_id, :relationship_type],
      name: :unique_user_mailbox_relationship
    )
    |> unique_constraint([:mailbox_id, :org_id, :relationship_type],
      name: :unique_org_mailbox_relationship
    )
    |> foreign_key_constraint(:mailbox_id)
    |> foreign_key_constraint(:user_id)
    |> foreign_key_constraint(:org_id)
    |> foreign_key_constraint(:granted_by)
  end

  defp validate_user_or_org_present(changeset) do
    user_id = get_field(changeset, :user_id)
    org_id = get_field(changeset, :org_id)

    if is_nil(user_id) and is_nil(org_id) do
      add_error(changeset, :user_id, "either user_id or org_id must be present")
    else
      changeset
    end
  end

  def key_types, do: @key_types
  def permission_levels, do: @permission_levels
  def relationship_types, do: @relationship_types
end