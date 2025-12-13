defmodule NukeApi.WorkOrders do
  @moduledoc """
  Work Orders context.

  For the mailbox-first workflow we primarily create "draft" work orders from user messages.
  """

  import Ecto.Query, warn: false
  alias NukeApi.Repo

  alias NukeApi.WorkOrders.WorkOrder
  alias NukeApi.WorkOrders.WorkOrderQuote
  alias NukeApi.WorkOrders.WorkOrderProof

  def get_work_order(id), do: Repo.get(WorkOrder, id)

  defp uuidb(nil), do: nil
  defp uuidb(v) when is_binary(v), do: Ecto.UUID.dump!(v)
  defp uuidb(v), do: v

  @proof_types ["before_photos", "after_photos", "timelapse", "receipt", "note", "other"]

  def proof_types, do: @proof_types

  def normalize_deliverables(deliverables) do
    deliverables
    |> List.wrap()
    |> Enum.map(&to_string/1)
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.filter(&(&1 in @proof_types))
    |> Enum.uniq()
  end

  def required_deliverables(%WorkOrder{metadata: metadata}) when is_map(metadata) do
    metadata
    |> Map.get("deliverables", Map.get(metadata, :deliverables, []))
    |> normalize_deliverables()
  end

  def required_deliverables(_), do: []

  def missing_deliverables(work_order_id, required) do
    required = normalize_deliverables(required)
    if required == [] do
      []
    else
      present =
        Repo.query!(
          """
          select proof_type
          from public.work_order_proofs
          where work_order_id = $1
            and (
              (array_length(urls, 1) is not null and array_length(urls, 1) > 0)
              or (notes is not null and length(trim(notes)) > 0)
            )
          group by proof_type
          """,
          [uuidb(work_order_id)]
        ).rows
        |> Enum.map(fn
          [t] -> to_string(t)
          _ -> nil
        end)
        |> Enum.reject(&is_nil/1)

      Enum.filter(required, fn req -> not (req in present) end)
    end
  end

  def create_draft_work_order(attrs) do
    %WorkOrder{}
    |> WorkOrder.changeset(Map.put(attrs, "status", Map.get(attrs, "status", "draft")))
    |> Repo.insert()
  end

  def publish_work_order(work_order_id, user_id, visibility \\ "invited") do
    Repo.transaction(fn ->
      wo = Repo.get!(WorkOrder, work_order_id)

      # only the customer can publish for now (enforced at controller level too)
      updates = %{
        status: "pending",
        is_published: true,
        published_at: DateTime.utc_now(),
        published_by: user_id,
        visibility: visibility
      }

      {:ok, updated} =
        wo
        |> WorkOrder.changeset(updates)
        |> Repo.update()

      updated
    end)
  end

  def list_quotes_for_work_order(work_order_id) do
    from(q in WorkOrderQuote,
      where: q.work_order_id == ^work_order_id,
      order_by: [desc: q.created_at]
    )
    |> Repo.all()
  end

  def create_quote(attrs) do
    %WorkOrderQuote{}
    |> WorkOrderQuote.changeset(attrs)
    |> Repo.insert()
  end

  def accept_quote!(work_order_id, quote_id) do
    Repo.transaction(fn ->
      quote =
        from(q in WorkOrderQuote, where: q.id == ^quote_id and q.work_order_id == ^work_order_id)
        |> Repo.one!()

      # accept selected quote
      {:ok, accepted} =
        quote
        |> WorkOrderQuote.changeset(%{status: "accepted"})
        |> Repo.update()

      # reject others
      from(q in WorkOrderQuote,
        where: q.work_order_id == ^work_order_id and q.id != ^quote_id and q.status in ["sent", "draft"]
      )
      |> Repo.update_all(set: [status: "rejected", updated_at: DateTime.utc_now()])

      # advance work order status
      from(wo in WorkOrder, where: wo.id == ^work_order_id)
      |> Repo.update_all(set: [status: "approved", updated_at: DateTime.utc_now()])

      accepted
    end)
  end

  def list_proofs(work_order_id) do
    from(p in WorkOrderProof,
      where: p.work_order_id == ^work_order_id,
      order_by: [desc: p.created_at]
    )
    |> Repo.all()
  end

  def create_proof(attrs) do
    %WorkOrderProof{}
    |> WorkOrderProof.changeset(attrs)
    |> Repo.insert()
  end

  def mark_work_order_completed!(work_order_id) do
    Repo.transaction(fn ->
      from(wo in WorkOrder, where: wo.id == ^work_order_id)
      |> Repo.update_all(set: [status: "completed", updated_at: DateTime.utc_now()])

      :ok
    end)
  end

  @doc """
  Grants a technician time-bounded access needed to upload proofs and operate in the mailbox thread.

  Writes:
  - vehicle_user_permissions(role=mechanic, expires_at, context includes work_order_id)
  - mailbox_access_keys(permission_level=read_write, relationship_type=service_provider, expires_at, conditions includes work_order_id)
  """
  def grant_proof_access!(vehicle_id, work_order_id, technician_user_id, granted_by_user_id, expires_at) do
    Repo.transaction(fn ->
      vehicle_id_b = uuidb(vehicle_id)
      work_order_id_s = to_string(work_order_id)
      tech_id_b = uuidb(technician_user_id)
      granted_by_b = uuidb(granted_by_user_id)

      # Upsert vehicle_user_permissions (this is what RLS checks for profile/image access)
      _ =
        Repo.query!(
          """
          insert into public.vehicle_user_permissions (
            vehicle_id,
            user_id,
            granted_by,
            role,
            permissions,
            context,
            is_active,
            granted_at,
            expires_at
          )
          values ($1, $2, $3, 'mechanic', $4, $5, true, now(), $6)
          on conflict (vehicle_id, user_id, role)
          do update set
            granted_by = excluded.granted_by,
            permissions = excluded.permissions,
            context = excluded.context,
            is_active = true,
            revoked_at = null,
            revoked_by = null,
            expires_at = excluded.expires_at,
            updated_at = now()
          """,
          [
            vehicle_id_b,
            tech_id_b,
            granted_by_b,
            ["proof_upload", "work_order_updates"],
            "work_order:" <> work_order_id_s,
            expires_at
          ]
        )

      # Get mailbox id for the vehicle
      mailbox_id =
        Repo.query!(
          "select id from public.vehicle_mailboxes where vehicle_id = $1 limit 1",
          [vehicle_id_b]
        ).rows
        |> List.first()
        |> case do
          [id] -> id
          _ -> raise "mailbox_not_found"
        end

      # Upsert mailbox access key scoped to this work order
      _ =
        Repo.query!(
          """
          insert into public.mailbox_access_keys (
            mailbox_id,
            user_id,
            key_type,
            permission_level,
            relationship_type,
            granted_by,
            expires_at,
            conditions
          )
          values ($1, $2, 'temporary', 'read_write', 'service_provider', $3, $4, $5::jsonb)
          on conflict (mailbox_id, user_id, relationship_type)
          do update set
            key_type = excluded.key_type,
            permission_level = excluded.permission_level,
            granted_by = excluded.granted_by,
            expires_at = excluded.expires_at,
            conditions = excluded.conditions,
            updated_at = now()
          """,
          [
            mailbox_id,
            tech_id_b,
            granted_by_b,
            expires_at,
            %{"scope" => "work_order", "work_order_id" => work_order_id}
          ]
        )

      :ok
    end)
  end

  @doc """
  Revoke proof access granted for a specific work order.

  Best-effort: marks vehicle_user_permissions inactive and expires mailbox_access_keys
  that are scoped (conditions.work_order_id) to this work order.
  """
  def revoke_proof_access!(vehicle_id, work_order_id, revoked_by_user_id) do
    Repo.transaction(fn ->
      vehicle_id_b = uuidb(vehicle_id)
      revoked_by_b = uuidb(revoked_by_user_id)
      work_order_id_s = to_string(work_order_id)

      # Deactivate any mechanic permissions scoped to this work order.
      _ =
        Repo.query!(
          """
          update public.vehicle_user_permissions
          set
            is_active = false,
            revoked_at = now(),
            revoked_by = $3,
            updated_at = now()
          where vehicle_id = $1
            and role = 'mechanic'
            and context = $2
            and coalesce(is_active, true) = true
          """,
          [vehicle_id_b, "work_order:" <> work_order_id_s, revoked_by_b]
        )

      # Expire any mailbox access keys scoped to this work order.
      mailbox_id =
        Repo.query!(
          "select id from public.vehicle_mailboxes where vehicle_id = $1 limit 1",
          [vehicle_id_b]
        ).rows
        |> List.first()
        |> case do
          [id] -> id
          _ -> nil
        end

      if mailbox_id do
        _ =
          Repo.query!(
            """
            update public.mailbox_access_keys
            set
              expires_at = now(),
              updated_at = now()
            where mailbox_id = $1
              and relationship_type = 'service_provider'
              and (
                conditions ->> 'work_order_id' = $2
                or (conditions ->> 'work_order_id')::text = $2
              )
            """,
            [mailbox_id, work_order_id_s]
          )
      end

      :ok
    end)
  end
end


