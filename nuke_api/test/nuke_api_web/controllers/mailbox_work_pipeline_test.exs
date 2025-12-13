defmodule NukeApiWeb.MailboxWorkPipelineTest do
  use NukeApiWeb.ConnCase, async: false

  import Phoenix.ConnTest

  alias NukeApi.Repo
  alias NukeApiWeb.MailboxController

  defp uuidb(uuid), do: Ecto.UUID.dump!(uuid)

  defp insert_auth_user!(id) do
    Repo.query!(
      "insert into auth.users (id) values ($1) on conflict (id) do nothing",
      [uuidb(id)]
    )
  end

  defp insert_vehicle!(vehicle_id, owner_user_id) do
    Repo.query!(
      """
      insert into public.vehicles (id, user_id, owner_id, make, model, year)
      values ($1, $2, $3, 'Ford', 'Mustang', 1967)
      on conflict (id) do nothing
      """,
      [uuidb(vehicle_id), uuidb(owner_user_id), uuidb(owner_user_id)]
    )
  end

  defp get_vehicle_mailbox_id!(vehicle_id) do
    Repo.query!(
      "select id from public.vehicle_mailboxes where vehicle_id = $1 limit 1",
      [uuidb(vehicle_id)]
    ).rows
    |> List.first()
    |> case do
      [id] -> Ecto.UUID.load!(id)
      _ -> raise "vehicle_mailbox_missing"
    end
  end

  defp grant_mailbox_access!(mailbox_id, user_id, relationship_type) do
    Repo.query!(
      """
      insert into public.mailbox_access_keys (
        mailbox_id, user_id, key_type, permission_level, relationship_type, granted_by, expires_at, conditions
      )
      values ($1, $2, 'master', 'read_write', $3, $2, null, '{}'::jsonb)
      on conflict (mailbox_id, user_id, relationship_type)
      do update set permission_level = excluded.permission_level, updated_at = now()
      """,
      [uuidb(mailbox_id), uuidb(user_id), relationship_type]
    )
  end

  defp grant_proof_access!(vehicle_id, work_order_id, tech_user_id, owner_user_id, mailbox_id) do
    # vehicle_user_permissions scoped to work order (what proof gating checks)
    Repo.query!(
      """
      insert into public.vehicle_user_permissions (
        vehicle_id, user_id, granted_by, role, permissions, context, is_active, granted_at, expires_at
      )
      values ($1, $2, $3, 'mechanic', $4, $5, true, now(), now() + interval '30 days')
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
        uuidb(vehicle_id),
        uuidb(tech_user_id),
        uuidb(owner_user_id),
        ["proof_upload", "work_order_updates"],
        "work_order:" <> to_string(work_order_id)
      ]
    )

    # mailbox access for tech
    Repo.query!(
      """
      insert into public.mailbox_access_keys (
        mailbox_id, user_id, key_type, permission_level, relationship_type, granted_by, expires_at, conditions
      )
      values ($1, $2, 'temporary', 'read_write', 'service_provider', $3, now() + interval '30 days', $4::jsonb)
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
        uuidb(mailbox_id),
        uuidb(tech_user_id),
        uuidb(owner_user_id),
        %{"scope" => "work_order", "work_order_id" => work_order_id}
      ]
    )
  end

  defp insert_work_order!(work_order_id, vehicle_id, owner_user_id, opts \\ %{}) do
    title = Map.get(opts, :title, "Rear side windows install")
    status = Map.get(opts, :status, "in_progress")
    is_published = Map.get(opts, :is_published, true)
    deliverables = Map.get(opts, :deliverables, [])

    Repo.query!(
      """
      insert into public.work_orders (
        id, vehicle_id, customer_id, title, description, urgency, status,
        request_source, is_published, published_at, published_by, visibility, metadata
      )
      values ($1, $2, $3, $4, 'Do the work', 'normal', $5,
        'mailbox', $6, now(), $3, 'invited', $7::jsonb
      )
      on conflict (id) do update set
        status = excluded.status,
        is_published = excluded.is_published,
        metadata = excluded.metadata,
        updated_at = now()
      """,
      [
        uuidb(work_order_id),
        uuidb(vehicle_id),
        uuidb(owner_user_id),
        title,
        status,
        is_published,
        %{"deliverables" => deliverables}
      ]
    )
  end

  defp insert_proof!(proof_id, work_order_id, vehicle_id, uploader_id, proof_type) do
    Repo.query!(
      """
      insert into public.work_order_proofs (
        id, work_order_id, vehicle_id, uploaded_by, proof_type, urls, notes, metadata
      )
      values ($1, $2, $3, $4, $5, array['https://example.com/proof.jpg'], null, '{}'::jsonb)
      on conflict (id) do nothing
      """,
      [uuidb(proof_id), uuidb(work_order_id), uuidb(vehicle_id), uuidb(uploader_id), proof_type]
    )
  end

  defp get_work_order_status(work_order_id) do
    Repo.query!(
      "select status from public.work_orders where id = $1",
      [uuidb(work_order_id)]
    ).rows
    |> List.first()
    |> case do
      [status] -> status
      _ -> nil
    end
  end

  defp count_active_mechanic_vup(vehicle_id, work_order_id) do
    Repo.query!(
      """
      select count(*)
      from public.vehicle_user_permissions
      where vehicle_id = $1
        and role = 'mechanic'
        and context = $2
        and coalesce(is_active, true) = true
      """,
      [uuidb(vehicle_id), "work_order:" <> to_string(work_order_id)]
    ).rows
    |> List.first()
    |> case do
      [n] when is_integer(n) -> n
      [n] when is_binary(n) -> String.to_integer(n)
      _ -> 0
    end
  end

  defp ensure_parts_pricing_tables!() do
    # Minimal tables required by QuoteAssembler.best_pricing_candidate/3
    Repo.query!(
      """
      create table if not exists public.data_source_registry (
        id uuid primary key default gen_random_uuid(),
        source_name text unique,
        source_url text,
        reliability_score numeric
      )
      """,
      []
    )

    Repo.query!(
      """
      create table if not exists public.parts_pricing (
        id uuid primary key default gen_random_uuid(),
        component_name text,
        component_type text,
        part_description text,
        part_number text,
        supplier_source_id uuid,
        supplier_name text,
        supplier_url text,
        price numeric,
        currency text,
        in_stock boolean,
        lead_time_days integer,
        make text,
        year_range_start integer,
        year_range_end integer
      )
      """,
      []
    )
  end

  test "tech completion request creates message but does not change work order status", %{conn: conn} do
    owner_id = Ecto.UUID.generate()
    tech_id = Ecto.UUID.generate()
    vehicle_id = Ecto.UUID.generate()
    work_order_id = Ecto.UUID.generate()

    insert_auth_user!(owner_id)
    insert_auth_user!(tech_id)
    insert_vehicle!(vehicle_id, owner_id)
    mailbox_id = get_vehicle_mailbox_id!(vehicle_id)

    grant_mailbox_access!(mailbox_id, owner_id, "owner")
    insert_work_order!(work_order_id, vehicle_id, owner_id, %{status: "in_progress", is_published: true})
    grant_proof_access!(vehicle_id, work_order_id, tech_id, owner_id, mailbox_id)

    before_status = get_work_order_status(work_order_id)

    conn =
      conn
      |> assign(:current_user_id, tech_id)
      |> MailboxController.request_work_order_completion(%{
        "vehicle_id" => vehicle_id,
        "work_order_id" => work_order_id,
        "note" => "All done, please review proofs"
      })

    assert %{"status" => "success"} = json_response(conn, 200)
    assert get_work_order_status(work_order_id) == before_status
  end

  test "owner completion is blocked with missing deliverables (409)", %{conn: conn} do
    owner_id = Ecto.UUID.generate()
    vehicle_id = Ecto.UUID.generate()
    work_order_id = Ecto.UUID.generate()

    insert_auth_user!(owner_id)
    insert_vehicle!(vehicle_id, owner_id)
    mailbox_id = get_vehicle_mailbox_id!(vehicle_id)
    grant_mailbox_access!(mailbox_id, owner_id, "owner")

    insert_work_order!(work_order_id, vehicle_id, owner_id, %{
      status: "in_progress",
      is_published: true,
      deliverables: ["before_photos", "after_photos"]
    })

    conn =
      conn
      |> assign(:current_user_id, owner_id)
      |> MailboxController.complete_work_order(%{
        "vehicle_id" => vehicle_id,
        "work_order_id" => work_order_id
      })

    body = json_response(conn, 409)
    assert body["message"] == "Missing required deliverables"
    assert Enum.sort(body["missing_deliverables"]) == ["after_photos", "before_photos"]
  end

  test "owner completion succeeds once required proofs exist", %{conn: conn} do
    owner_id = Ecto.UUID.generate()
    tech_id = Ecto.UUID.generate()
    vehicle_id = Ecto.UUID.generate()
    work_order_id = Ecto.UUID.generate()

    insert_auth_user!(owner_id)
    insert_auth_user!(tech_id)
    insert_vehicle!(vehicle_id, owner_id)
    mailbox_id = get_vehicle_mailbox_id!(vehicle_id)
    grant_mailbox_access!(mailbox_id, owner_id, "owner")

    insert_work_order!(work_order_id, vehicle_id, owner_id, %{
      status: "in_progress",
      is_published: true,
      deliverables: ["before_photos", "after_photos"]
    })

    # proofs uploaded by tech
    insert_proof!(Ecto.UUID.generate(), work_order_id, vehicle_id, tech_id, "before_photos")
    insert_proof!(Ecto.UUID.generate(), work_order_id, vehicle_id, tech_id, "after_photos")

    # access existed before completion (should be revoked by finalize)
    grant_proof_access!(vehicle_id, work_order_id, tech_id, owner_id, mailbox_id)
    assert count_active_mechanic_vup(vehicle_id, work_order_id) == 1

    conn =
      conn
      |> assign(:current_user_id, owner_id)
      |> MailboxController.complete_work_order(%{
        "vehicle_id" => vehicle_id,
        "work_order_id" => work_order_id
      })

    assert %{"status" => "success"} = json_response(conn, 200)
    assert get_work_order_status(work_order_id) == "completed"
    assert count_active_mechanic_vup(vehicle_id, work_order_id) == 0
  end

  test "tech cannot request completion without proof access context", %{conn: conn} do
    owner_id = Ecto.UUID.generate()
    tech_id = Ecto.UUID.generate()
    vehicle_id = Ecto.UUID.generate()
    work_order_id = Ecto.UUID.generate()

    insert_auth_user!(owner_id)
    insert_auth_user!(tech_id)
    insert_vehicle!(vehicle_id, owner_id)
    mailbox_id = get_vehicle_mailbox_id!(vehicle_id)

    # tech has mailbox access, but no vehicle_user_permissions context
    grant_mailbox_access!(mailbox_id, owner_id, "owner")
    grant_mailbox_access!(mailbox_id, tech_id, "service_provider")
    insert_work_order!(work_order_id, vehicle_id, owner_id, %{status: "in_progress", is_published: true})

    conn =
      conn
      |> assign(:current_user_id, tech_id)
      |> MailboxController.request_work_order_completion(%{
        "vehicle_id" => vehicle_id,
        "work_order_id" => work_order_id
      })

    assert %{"message" => "Not authorized"} = json_response(conn, 403)
  end

  test "tech completion request is blocked if work order is not published", %{conn: conn} do
    owner_id = Ecto.UUID.generate()
    tech_id = Ecto.UUID.generate()
    vehicle_id = Ecto.UUID.generate()
    work_order_id = Ecto.UUID.generate()

    insert_auth_user!(owner_id)
    insert_auth_user!(tech_id)
    insert_vehicle!(vehicle_id, owner_id)
    mailbox_id = get_vehicle_mailbox_id!(vehicle_id)
    grant_mailbox_access!(mailbox_id, owner_id, "owner")

    insert_work_order!(work_order_id, vehicle_id, owner_id, %{status: "in_progress", is_published: false})
    grant_proof_access!(vehicle_id, work_order_id, tech_id, owner_id, mailbox_id)

    conn =
      conn
      |> assign(:current_user_id, tech_id)
      |> MailboxController.request_work_order_completion(%{
        "vehicle_id" => vehicle_id,
        "work_order_id" => work_order_id
      })

    assert %{"message" => "Work order is not ready for completion request"} = json_response(conn, 409)
  end

  test "assemble quote returns 409 with missing list when nothing matches", %{conn: conn} do
    owner_id = Ecto.UUID.generate()
    vehicle_id = Ecto.UUID.generate()
    work_order_id = Ecto.UUID.generate()

    insert_auth_user!(owner_id)
    insert_vehicle!(vehicle_id, owner_id)
    mailbox_id = get_vehicle_mailbox_id!(vehicle_id)
    grant_mailbox_access!(mailbox_id, owner_id, "owner")
    insert_work_order!(work_order_id, vehicle_id, owner_id, %{status: "in_progress", is_published: true})

    conn =
      conn
      |> assign(:current_user_id, owner_id)
      |> MailboxController.assemble_work_order_quote(%{
        "vehicle_id" => vehicle_id,
        "work_order_id" => work_order_id,
        "part_queries" => ["__NO_MATCH_QUERY__"]
      })

    body = json_response(conn, 409)
    assert body["message"] == "No priced parts found for these queries"
    assert is_map(body["data"])
    assert body["data"]["missing"] == ["__NO_MATCH_QUERY__"]
  end

  test "assemble quote creates a draft work_order_quote and mailbox quote message when priced parts exist", %{conn: conn} do
    owner_id = Ecto.UUID.generate()
    vehicle_id = Ecto.UUID.generate()
    work_order_id = Ecto.UUID.generate()

    insert_auth_user!(owner_id)
    insert_vehicle!(vehicle_id, owner_id)
    mailbox_id = get_vehicle_mailbox_id!(vehicle_id)
    grant_mailbox_access!(mailbox_id, owner_id, "owner")
    insert_work_order!(work_order_id, vehicle_id, owner_id, %{status: "in_progress", is_published: true})

    ensure_parts_pricing_tables!()

    dsr_id = Ecto.UUID.generate()

    Repo.query!(
      """
      insert into public.data_source_registry (id, source_name, source_url, reliability_score)
      values ($1, 'RockAuto', 'https://www.rockauto.com', 0.9)
      on conflict (id) do nothing
      """,
      [uuidb(dsr_id)]
    )

    # This matches the vehicle inserted by insert_vehicle!/2 (Ford, 1967)
    pricing_id = Ecto.UUID.generate()

    Repo.query!(
      """
      insert into public.parts_pricing (
        id, component_name, part_description, part_number,
        supplier_source_id, supplier_name, supplier_url,
        price, currency, in_stock, lead_time_days,
        make, year_range_start, year_range_end
      )
      values (
        $1, 'rear window seals', 'Rear window seal kit', 'RW-123',
        $2, 'RockAuto', 'https://www.rockauto.com/en/part/RW-123',
        12.34, 'USD', true, 2,
        'Ford', 1960, 1970
      )
      on conflict (id) do nothing
      """,
      [uuidb(pricing_id), uuidb(dsr_id)]
    )

    conn =
      conn
      |> assign(:current_user_id, owner_id)
      |> MailboxController.assemble_work_order_quote(%{
        "vehicle_id" => vehicle_id,
        "work_order_id" => work_order_id,
        "part_queries" => ["rear window seals"]
      })

    body = json_response(conn, 200)
    assert body["status"] == "success"

    quote = body["data"]["quote"]
    assert quote["status"] == "draft"
    assert quote["amount_cents"] == 1234
    assert quote["parts_cents"] == 1234

    msg = body["data"]["mailbox_message"]
    assert msg["message_type"] == "quote"
    assert msg["metadata"]["origin"] == "system_quote_assembler_v1"

    # Ensure it really wrote to work_order_quotes
    count =
      Repo.query!(
        "select count(*) from public.work_order_quotes where work_order_id = $1",
        [uuidb(work_order_id)]
      ).rows
      |> List.first()
      |> case do
        [n] when is_integer(n) -> n
        [n] when is_binary(n) -> String.to_integer(n)
        _ -> 0
      end

    assert count >= 1
  end

  test "assemble quote with agent enabled but missing API key fails safely (400)", %{conn: conn} do
    owner_id = Ecto.UUID.generate()
    vehicle_id = Ecto.UUID.generate()
    work_order_id = Ecto.UUID.generate()

    insert_auth_user!(owner_id)
    insert_vehicle!(vehicle_id, owner_id)
    mailbox_id = get_vehicle_mailbox_id!(vehicle_id)
    grant_mailbox_access!(mailbox_id, owner_id, "owner")
    insert_work_order!(work_order_id, vehicle_id, owner_id, %{status: "in_progress", is_published: true})

    # NOTE: In test we typically don't have Supabase URL/api key configured for Phoenix to call Edge Functions.
    conn =
      conn
      |> assign(:current_user_id, owner_id)
      |> MailboxController.assemble_work_order_quote(%{
        "vehicle_id" => vehicle_id,
        "work_order_id" => work_order_id,
        "part_queries" => [],
        "agent" => %{
          "enabled" => true,
          "provider" => "openai",
          "context_sources" => ["vehicle_profile", "work_order", "knowledge_library"]
        }
      })

    body = json_response(conn, 400)
    assert body["status"] == "error"
    assert body["message"] == "Supabase function caller not configured"
  end
end


