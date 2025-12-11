defmodule NukeApiWeb.MailboxController do
  use NukeApiWeb, :controller

  alias NukeApi.Mailbox
  alias NukeApi.Mailbox.{VehicleMailbox, MailboxMessage, MailboxAccessKey}

  # Get vehicle mailbox with user's access level
  def show_vehicle_mailbox(conn, %{"vehicle_id" => vehicle_id}) do
    user_id = get_user_id(conn)

    case Mailbox.get_vehicle_mailbox_with_access(vehicle_id, user_id) do
      {:ok, mailbox} ->
        json(conn, %{
          status: "success",
          data: %{
            mailbox: mailbox,
            access_level: mailbox.user_access_level,
            message_count: mailbox.unread_count
          }
        })

      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{status: "error", message: "Vehicle mailbox not found"})

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{status: "error", message: "Access denied to this mailbox"})
    end
  end

  # Get messages for a vehicle mailbox
  def get_messages(conn, %{"vehicle_id" => vehicle_id} = params) do
    user_id = get_user_id(conn)
    page = Map.get(params, "page", 1) |> String.to_integer()
    limit = Map.get(params, "limit", 20) |> String.to_integer()
    message_type = Map.get(params, "type")

    case Mailbox.get_mailbox_messages(vehicle_id, user_id, page, limit, message_type) do
      {:ok, messages} ->
        json(conn, %{
          status: "success",
          data: messages,
          pagination: %{
            page: page,
            limit: limit,
            total_count: length(messages)
          }
        })

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{status: "error", message: "Access denied to this mailbox"})
    end
  end

  # Send message to vehicle mailbox
  def create_message(conn, %{"vehicle_id" => vehicle_id} = params) do
    user_id = get_user_id(conn)

    message_params = %{
      "vehicle_id" => vehicle_id,
      "sender_id" => user_id,
      "sender_type" => "user",
      "message_type" => Map.get(params, "message_type", "system_alert"),
      "title" => Map.get(params, "title"),
      "content" => Map.get(params, "content"),
      "priority" => Map.get(params, "priority", "medium"),
      "metadata" => Map.get(params, "metadata", %{})
    }

    case Mailbox.create_message(message_params, user_id) do
      {:ok, message} ->
        # Trigger real-time notifications to all mailbox subscribers
        broadcast_message_created(vehicle_id, message)

        json(conn, %{
          status: "success",
          data: message,
          message: "Message sent successfully"
        })

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{status: "error", message: "Access denied to send messages"})

      {:error, changeset} ->
        conn
        |> put_status(:bad_request)
        |> json(%{
          status: "error",
          message: "Invalid message data",
          errors: format_changeset_errors(changeset)
        })
    end
  end

  # Mark message as read
  def mark_read(conn, %{"vehicle_id" => vehicle_id, "message_id" => message_id}) do
    user_id = get_user_id(conn)

    case Mailbox.mark_message_read(message_id, user_id, vehicle_id) do
      {:ok, message} ->
        json(conn, %{
          status: "success",
          data: message,
          message: "Message marked as read"
        })

      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{status: "error", message: "Message not found"})

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{status: "error", message: "Access denied"})
    end
  end

  # Resolve/close a message (for actionable notifications like duplicates)
  def resolve_message(conn, %{"vehicle_id" => vehicle_id, "message_id" => message_id} = params) do
    user_id = get_user_id(conn)
    resolution_data = Map.get(params, "resolution_data", %{})

    case Mailbox.resolve_message(message_id, user_id, vehicle_id, resolution_data) do
      {:ok, message} ->
        # Handle specific resolution actions based on message type
        handle_message_resolution(message, resolution_data, vehicle_id)

        json(conn, %{
          status: "success",
          data: message,
          message: "Message resolved successfully"
        })

      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{status: "error", message: "Message not found"})

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{status: "error", message: "Access denied"})
    end
  end

  # Grant access key to another user
  def grant_access(conn, %{"vehicle_id" => vehicle_id} = params) do
    granting_user_id = get_user_id(conn)

    access_params = %{
      "vehicle_id" => vehicle_id,
      "user_id" => Map.get(params, "user_id"),
      "org_id" => Map.get(params, "org_id"),
      "key_type" => Map.get(params, "key_type", "temporary"),
      "permission_level" => Map.get(params, "permission_level", "read_only"),
      "relationship_type" => Map.get(params, "relationship_type"),
      "expires_at" => Map.get(params, "expires_at"),
      "conditions" => Map.get(params, "conditions", %{}),
      "granted_by" => granting_user_id
    }

    case Mailbox.grant_access_key(access_params, granting_user_id) do
      {:ok, access_key} ->
        # Notify the recipient of new access
        notify_access_granted(access_key)

        json(conn, %{
          status: "success",
          data: access_key,
          message: "Access granted successfully"
        })

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{status: "error", message: "Only vehicle owner can grant access"})

      {:error, changeset} ->
        conn
        |> put_status(:bad_request)
        |> json(%{
          status: "error",
          message: "Invalid access parameters",
          errors: format_changeset_errors(changeset)
        })
    end
  end

  # Revoke access key
  def revoke_access(conn, %{"vehicle_id" => vehicle_id, "access_key_id" => access_key_id}) do
    revoking_user_id = get_user_id(conn)

    case Mailbox.revoke_access_key(access_key_id, revoking_user_id, vehicle_id) do
      {:ok, access_key} ->
        # Notify the user their access was revoked
        notify_access_revoked(access_key)

        json(conn, %{
          status: "success",
          message: "Access revoked successfully"
        })

      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{status: "error", message: "Access key not found"})

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{status: "error", message: "Unauthorized to revoke this access"})
    end
  end

  # List access keys for a vehicle (owner only)
  def list_access_keys(conn, %{"vehicle_id" => vehicle_id}) do
    user_id = get_user_id(conn)

    case Mailbox.list_vehicle_access_keys(vehicle_id, user_id) do
      {:ok, access_keys} ->
        json(conn, %{
          status: "success",
          data: access_keys
        })

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{status: "error", message: "Only vehicle owner can view access keys"})
    end
  end

  # Get duplicate detection details for a specific message
  def get_duplicate_details(conn, %{"vehicle_id" => vehicle_id, "message_id" => message_id}) do
    user_id = get_user_id(conn)

    case Mailbox.get_duplicate_detection_details(message_id, user_id, vehicle_id) do
      {:ok, details} ->
        json(conn, %{
          status: "success",
          data: details
        })

      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{status: "error", message: "Duplicate detection not found"})

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{status: "error", message: "Access denied"})
    end
  end

  # Confirm or reject duplicate detection
  def handle_duplicate_confirmation(conn, %{"vehicle_id" => vehicle_id, "message_id" => message_id} = params) do
    user_id = get_user_id(conn)
    action = Map.get(params, "action") # "confirm" or "reject"

    case Mailbox.handle_duplicate_confirmation(message_id, user_id, vehicle_id, action) do
      {:ok, result} ->
        json(conn, %{
          status: "success",
          data: result,
          message: "Duplicate #{action}ed successfully"
        })

      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{status: "error", message: "Duplicate detection not found"})

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{status: "error", message: "Access denied"})

      {:error, :invalid_action} ->
        conn
        |> put_status(:bad_request)
        |> json(%{status: "error", message: "Invalid action. Use 'confirm' or 'reject'"})
    end
  end

  # Private helper functions

  defp get_user_id(conn) do
    # Extract user ID from auth token/session
    # This should be set by the AuthPlug
    conn.assigns[:current_user_id] || get_session(conn, :user_id)
  end

  defp broadcast_message_created(vehicle_id, message) do
    # Broadcast to all users with access to this vehicle's mailbox
    NukeApiWeb.Endpoint.broadcast("mailbox:#{vehicle_id}", "message_created", %{
      message: message
    })
  end

  defp handle_message_resolution(message, resolution_data, vehicle_id) do
    case message.message_type do
      "duplicate_detected" ->
        # Handle duplicate detection resolution
        handle_duplicate_resolution(message, resolution_data, vehicle_id)

      "ownership_transfer" ->
        # Handle ownership transfer completion
        handle_ownership_transfer_resolution(message, resolution_data, vehicle_id)

      _ ->
        :ok
    end
  end

  defp handle_duplicate_resolution(message, resolution_data, vehicle_id) do
    duplicate_vehicle_id = get_in(message.metadata, ["duplicate_vehicle_id"])
    action = Map.get(resolution_data, "action")

    case action do
      "merge" ->
        # Trigger vehicle merge process
        Task.start(fn ->
          NukeApi.Vehicles.merge_duplicate_vehicles(vehicle_id, duplicate_vehicle_id)
        end)

      "ignore" ->
        # Mark as false positive
        NukeApi.Mailbox.mark_duplicate_as_false_positive(vehicle_id, duplicate_vehicle_id)

      _ ->
        :ok
    end
  end

  defp handle_ownership_transfer_resolution(message, resolution_data, vehicle_id) do
    new_owner_id = Map.get(resolution_data, "new_owner_id")

    if new_owner_id do
      Task.start(fn ->
        NukeApi.Vehicles.transfer_ownership(vehicle_id, new_owner_id)
      end)
    end
  end

  defp notify_access_granted(access_key) do
    if access_key.user_id do
      # Send notification to user about new access
      NukeApi.Notifications.send_access_granted_notification(access_key)
    end
  end

  defp notify_access_revoked(access_key) do
    if access_key.user_id do
      # Send notification to user about revoked access
      NukeApi.Notifications.send_access_revoked_notification(access_key)
    end
  end

  defp format_changeset_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end
end