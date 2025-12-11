defmodule NukeApi.Mailbox do
  @moduledoc """
  Vehicle Mailbox System Context

  Handles vehicle-centric notifications and communications with relationship-based access control.
  Each vehicle has its own mailbox that users can access based on their relationship to the vehicle.
  """

  import Ecto.Query, warn: false
  alias NukeApi.Repo

  alias NukeApi.Mailbox.{VehicleMailbox, MailboxMessage, MailboxAccessKey, DuplicateDetection}
  alias NukeApi.Vehicles.Vehicle

  # Vehicle Mailbox operations

  @doc """
  Gets a vehicle mailbox with user's access level, or creates one if it doesn't exist.
  """
  def get_vehicle_mailbox_with_access(vehicle_id, user_id) do
    with {:ok, vehicle} <- get_vehicle(vehicle_id),
         {:ok, mailbox} <- get_or_create_mailbox(vehicle),
         {:ok, access_level} <- check_user_access(mailbox.id, user_id) do
      mailbox_with_access = %{
        mailbox
        | user_access_level: access_level,
          unread_count: get_unread_message_count(mailbox.id, user_id)
      }

      {:ok, mailbox_with_access}
    else
      {:error, :not_found} -> {:error, :not_found}
      {:error, :no_access} -> {:error, :unauthorized}
      error -> error
    end
  end

  @doc """
  Gets messages for a vehicle mailbox that the user has access to.
  """
  def get_mailbox_messages(vehicle_id, user_id, page \\ 1, limit \\ 20, message_type \\ nil) do
    with {:ok, mailbox} <- get_vehicle_mailbox(vehicle_id),
         {:ok, _access_level} <- check_user_access(mailbox.id, user_id) do
      query =
        from(m in MailboxMessage,
          where: m.mailbox_id == ^mailbox.id,
          order_by: [desc: m.created_at],
          limit: ^limit,
          offset: ^((page - 1) * limit)
        )

      query =
        if message_type do
          from(m in query, where: m.message_type == ^message_type)
        else
          query
        end

      messages = Repo.all(query)
      {:ok, messages}
    else
      {:error, :no_access} -> {:error, :unauthorized}
      error -> error
    end
  end

  @doc """
  Creates a new message in a vehicle's mailbox.
  """
  def create_message(attrs, user_id) do
    vehicle_id = Map.get(attrs, "vehicle_id")

    with {:ok, mailbox} <- get_vehicle_mailbox(vehicle_id),
         {:ok, access_level} <- check_user_access(mailbox.id, user_id),
         true <- can_write_messages?(access_level) do
      message_attrs = Map.put(attrs, "mailbox_id", mailbox.id)

      %MailboxMessage{}
      |> MailboxMessage.changeset(message_attrs)
      |> Repo.insert()
    else
      {:error, :no_access} -> {:error, :unauthorized}
      false -> {:error, :unauthorized}
      error -> error
    end
  end

  @doc """
  Marks a message as read by a specific user.
  """
  def mark_message_read(message_id, user_id, vehicle_id) do
    with {:ok, message} <- get_message_with_access_check(message_id, user_id, vehicle_id),
         {:ok, updated_message} <- update_message_read_status(message, user_id) do
      {:ok, updated_message}
    else
      error -> error
    end
  end

  @doc """
  Resolves/closes a message with optional resolution data.
  """
  def resolve_message(message_id, user_id, vehicle_id, resolution_data \\ %{}) do
    with {:ok, message} <- get_message_with_access_check(message_id, user_id, vehicle_id),
         {:ok, updated_message} <- update_message_resolution(message, user_id, resolution_data) do
      {:ok, updated_message}
    else
      error -> error
    end
  end

  # Access Key Management

  @doc """
  Grants access to a vehicle's mailbox.
  """
  def grant_access_key(attrs, granting_user_id) do
    vehicle_id = Map.get(attrs, "vehicle_id")

    with {:ok, mailbox} <- get_vehicle_mailbox(vehicle_id),
         true <- is_vehicle_owner?(vehicle_id, granting_user_id) do
      access_attrs = Map.put(attrs, "mailbox_id", mailbox.id)

      %MailboxAccessKey{}
      |> MailboxAccessKey.changeset(access_attrs)
      |> Repo.insert()
    else
      false -> {:error, :unauthorized}
      error -> error
    end
  end

  @doc """
  Revokes an access key.
  """
  def revoke_access_key(access_key_id, revoking_user_id, vehicle_id) do
    with {:ok, access_key} <- get_access_key(access_key_id),
         true <- can_revoke_access?(access_key, revoking_user_id, vehicle_id) do
      Repo.delete(access_key)
    else
      false -> {:error, :unauthorized}
      error -> error
    end
  end

  @doc """
  Lists all access keys for a vehicle (owner only).
  """
  def list_vehicle_access_keys(vehicle_id, user_id) do
    with {:ok, mailbox} <- get_vehicle_mailbox(vehicle_id),
         true <- is_vehicle_owner?(vehicle_id, user_id) do
      access_keys =
        from(ak in MailboxAccessKey,
          where: ak.mailbox_id == ^mailbox.id,
          order_by: [desc: ak.created_at],
          preload: [:user, :org]
        )
        |> Repo.all()

      {:ok, access_keys}
    else
      false -> {:error, :unauthorized}
      error -> error
    end
  end

  # Duplicate Detection

  @doc """
  Gets duplicate detection details for a message.
  """
  def get_duplicate_detection_details(message_id, user_id, vehicle_id) do
    with {:ok, message} <- get_message_with_access_check(message_id, user_id, vehicle_id),
         true <- message.message_type == "duplicate_detected",
         duplicate_vehicle_id when not is_nil(duplicate_vehicle_id) <-
           get_in(message.metadata, ["duplicate_vehicle_id"]) do
      duplicate_detection =
        from(dd in DuplicateDetection,
          where: dd.original_vehicle_id == ^vehicle_id and dd.duplicate_vehicle_id == ^duplicate_vehicle_id,
          preload: [:original_vehicle, :duplicate_vehicle]
        )
        |> Repo.one()

      if duplicate_detection do
        {:ok, duplicate_detection}
      else
        {:error, :not_found}
      end
    else
      false -> {:error, :not_found}
      nil -> {:error, :not_found}
      error -> error
    end
  end

  @doc """
  Handles duplicate confirmation/rejection.
  """
  def handle_duplicate_confirmation(message_id, user_id, vehicle_id, action) do
    case action do
      action when action in ["confirm", "reject"] ->
        with {:ok, message} <- get_message_with_access_check(message_id, user_id, vehicle_id),
             true <- message.message_type == "duplicate_detected",
             duplicate_vehicle_id when not is_nil(duplicate_vehicle_id) <-
               get_in(message.metadata, ["duplicate_vehicle_id"]) do
          status = if action == "confirm", do: "confirmed", else: "rejected"

          case update_duplicate_detection_status(vehicle_id, duplicate_vehicle_id, status, user_id) do
            {:ok, detection} ->
              # Mark message as resolved
              resolve_message(message_id, user_id, vehicle_id, %{"action" => action})
              {:ok, detection}

            error ->
              error
          end
        else
          false -> {:error, :not_found}
          nil -> {:error, :not_found}
          error -> error
        end

      _ ->
        {:error, :invalid_action}
    end
  end

  @doc """
  Marks a duplicate detection as false positive.
  """
  def mark_duplicate_as_false_positive(original_vehicle_id, duplicate_vehicle_id) do
    update_duplicate_detection_status(original_vehicle_id, duplicate_vehicle_id, "rejected", nil)
  end

  # Private helper functions

  defp get_vehicle(vehicle_id) do
    case Repo.get(Vehicle, vehicle_id) do
      nil -> {:error, :not_found}
      vehicle -> {:ok, vehicle}
    end
  end

  defp get_or_create_mailbox(vehicle) do
    case Repo.get_by(VehicleMailbox, vehicle_id: vehicle.id) do
      nil ->
        # Create new mailbox
        %VehicleMailbox{}
        |> VehicleMailbox.changeset(%{
          vehicle_id: vehicle.id,
          vin: vehicle.vin
        })
        |> Repo.insert()

      mailbox ->
        {:ok, mailbox}
    end
  end

  defp get_vehicle_mailbox(vehicle_id) do
    case Repo.get_by(VehicleMailbox, vehicle_id: vehicle_id) do
      nil -> {:error, :not_found}
      mailbox -> {:ok, mailbox}
    end
  end

  defp check_user_access(mailbox_id, user_id) do
    query =
      from(ak in MailboxAccessKey,
        where:
          ak.mailbox_id == ^mailbox_id and
            (ak.user_id == ^user_id or
               ak.org_id in subquery(
                 from(uo in "user_organizations", where: uo.user_id == ^user_id, select: uo.organization_id)
               )) and
            (is_nil(ak.expires_at) or ak.expires_at > ^DateTime.utc_now()),
        order_by: [desc: ak.permission_level],
        limit: 1
      )

    case Repo.one(query) do
      nil -> {:error, :no_access}
      access_key -> {:ok, access_key.permission_level}
    end
  end

  defp can_write_messages?(permission_level) do
    permission_level in ["read_write", "write_only"]
  end

  defp get_unread_message_count(mailbox_id, user_id) do
    from(m in MailboxMessage,
      where: m.mailbox_id == ^mailbox_id and not fragment("? @> ?", m.read_by, ^[user_id]),
      select: count()
    )
    |> Repo.one()
  end

  defp get_message_with_access_check(message_id, user_id, vehicle_id) do
    with {:ok, mailbox} <- get_vehicle_mailbox(vehicle_id),
         {:ok, _access_level} <- check_user_access(mailbox.id, user_id),
         message when not is_nil(message) <-
           Repo.get_by(MailboxMessage, id: message_id, mailbox_id: mailbox.id) do
      {:ok, message}
    else
      nil -> {:error, :not_found}
      {:error, :no_access} -> {:error, :unauthorized}
      error -> error
    end
  end

  defp update_message_read_status(message, user_id) do
    current_read_by = message.read_by || []
    new_read_by = [user_id | current_read_by] |> Enum.uniq()

    message
    |> MailboxMessage.changeset(%{read_by: new_read_by})
    |> Repo.update()
  end

  defp update_message_resolution(message, user_id, resolution_data) do
    message
    |> MailboxMessage.changeset(%{
      resolved_at: DateTime.utc_now(),
      resolved_by: user_id,
      metadata: Map.merge(message.metadata || %{}, resolution_data)
    })
    |> Repo.update()
  end

  defp is_vehicle_owner?(vehicle_id, user_id) do
    case Repo.get(Vehicle, vehicle_id) do
      nil -> false
      vehicle -> vehicle.owner_id == user_id
    end
  end

  defp get_access_key(access_key_id) do
    case Repo.get(MailboxAccessKey, access_key_id) do
      nil -> {:error, :not_found}
      access_key -> {:ok, access_key}
    end
  end

  defp can_revoke_access?(access_key, revoking_user_id, vehicle_id) do
    # Owner can revoke any access, users can revoke their own access
    is_vehicle_owner?(vehicle_id, revoking_user_id) or access_key.user_id == revoking_user_id
  end

  defp update_duplicate_detection_status(original_vehicle_id, duplicate_vehicle_id, status, reviewed_by) do
    query =
      from(dd in DuplicateDetection,
        where: dd.original_vehicle_id == ^original_vehicle_id and dd.duplicate_vehicle_id == ^duplicate_vehicle_id
      )

    updates = %{
      status: status,
      reviewed_at: DateTime.utc_now()
    }

    updates =
      if reviewed_by do
        Map.put(updates, :reviewed_by, reviewed_by)
      else
        updates
      end

    case Repo.update_all(query, set: Keyword.new(updates)) do
      {1, _} -> {:ok, %{status: status}}
      {0, _} -> {:error, :not_found}
    end
  end
end