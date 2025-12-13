defmodule NukeApi.QuoteAssemblySimulationTest do
  use NukeApiWeb.ConnCase, async: false

  alias NukeApi.Repo
  alias NukeApiWeb.MailboxController

  defp uuidb(uuid), do: Ecto.UUID.dump!(uuid)

  defp insert_auth_user!(id) do
    Repo.query!(
      "insert into auth.users (id) values ($1) on conflict (id) do nothing",
      [uuidb(id)]
    )
  end

  defp insert_vehicle!(vehicle_id, owner_user_id, make, model, year) do
    Repo.query!(
      """
      insert into public.vehicles (id, user_id, owner_id, make, model, year)
      values ($1, $2, $3, $4, $5, $6)
      on conflict (id) do nothing
      """,
      [uuidb(vehicle_id), uuidb(owner_user_id), uuidb(owner_user_id), make, model, year]
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

  defp insert_work_order!(work_order_id, vehicle_id, owner_user_id) do
    Repo.query!(
      """
      insert into public.work_orders (
        id, vehicle_id, customer_id, title, description, urgency, status,
        request_source, is_published, published_at, published_by, visibility, metadata
      )
      values ($1, $2, $3, 'Simulated Work', 'Do the work', 'normal', 'in_progress',
        'mailbox', true, now(), $3, 'invited', '{}'::jsonb
      )
      on conflict (id) do update set updated_at = now()
      """,
      [uuidb(work_order_id), uuidb(vehicle_id), uuidb(owner_user_id)]
    )
  end

  defp ensure_parts_pricing_tables!() do
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

  defp insert_pricing!(attrs) do
    Repo.query!(
      """
      insert into public.parts_pricing (
        id, component_name, part_description, part_number,
        supplier_source_id, supplier_name, supplier_url,
        price, currency, in_stock, lead_time_days,
        make, year_range_start, year_range_end
      )
      values (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, $14
      )
      on conflict (id) do nothing
      """,
      [
        uuidb(attrs.id),
        attrs.component_name,
        attrs.part_description,
        attrs.part_number,
        uuidb(attrs.supplier_source_id),
        attrs.supplier_name,
        attrs.supplier_url,
        attrs.price,
        attrs.currency,
        attrs.in_stock,
        attrs.lead_time_days,
        attrs.make,
        attrs.year_start,
        attrs.year_end
      ]
    )
  end

  defp expected_best(candidates) do
    # Mirrors QuoteAssembler SQL ordering:
    # in_stock=true first, then lead_time_days asc (null -> 999), then price asc
    candidates
    |> Enum.sort_by(fn c ->
      {
        if(c.in_stock, do: 0, else: 1),
        c.lead_time_days || 999,
        c.price
      }
    end)
    |> List.first()
  end

  test "simulation: quote assembly consistently picks the best candidate and never crashes", %{conn: conn} do
    ensure_parts_pricing_tables!()

    # deterministic simulation
    :rand.seed(:exsss, {1, 2, 3})

    iterations = 20

    for i <- 1..iterations do
      owner_id = Ecto.UUID.generate()
      vehicle_id = Ecto.UUID.generate()
      work_order_id = Ecto.UUID.generate()

      insert_auth_user!(owner_id)

      # keep make/year stable so matching is predictable
      make = "Ford"
      model = "Mustang"
      year = 1967
      insert_vehicle!(vehicle_id, owner_id, make, model, year)

      mailbox_id = get_vehicle_mailbox_id!(vehicle_id)
      grant_mailbox_access!(mailbox_id, owner_id, "owner")
      insert_work_order!(work_order_id, vehicle_id, owner_id)

      query = "rear window seals sim #{i}"
      dsr_id = Ecto.UUID.generate()

      Repo.query!(
        """
        insert into public.data_source_registry (id, source_name, source_url, reliability_score)
        values ($1, $2, $3, 0.8)
        on conflict (id) do nothing
        """,
        [uuidb(dsr_id), "Provider #{i}", "https://example.com/#{i}"]
      )

      # Create 3 candidates with randomized attributes.
      candidates =
        Enum.map(1..3, fn j ->
          %{
            id: Ecto.UUID.generate(),
            supplier_source_id: dsr_id,
            supplier_name: "Provider #{i}",
            supplier_url: "https://example.com/#{i}/p/#{j}",
            component_name: query,
            part_description: "Desc #{j}",
            part_number: "PN-#{i}-#{j}",
            currency: "USD",
            in_stock: :rand.uniform(2) == 1,
            lead_time_days: Enum.random([nil, 1, 2, 5, 10]),
            price: Decimal.new("#{Enum.random(5..50)}.#{Enum.random(0..99) |> Integer.to_string() |> String.pad_leading(2, "0")}"),
            make: make,
            year_start: 1960,
            year_end: 1970
          }
        end)

      Enum.each(candidates, &insert_pricing!/1)
      expected = expected_best(candidates)

      conn =
        conn
        |> recycle()
        |> assign(:current_user_id, owner_id)
        |> MailboxController.assemble_work_order_quote(%{
          "vehicle_id" => vehicle_id,
          "work_order_id" => work_order_id,
          "part_queries" => [query]
        })

      body = json_response(conn, 200)
      assert body["status"] == "success"

      assembled = body["data"]["assembled"]
      assert assembled["missing"] == []
      assert length(assembled["line_items"]) == 1

      selected = get_in(assembled, ["line_items", Access.at(0), "selected"])
      assert selected["part_number"] == expected.part_number
      assert selected["supplier_url"] == expected.supplier_url
      assert selected["in_stock"] == expected.in_stock
    end
  end

  test "simulation: missing-data behavior (all missing => 409, partial missing => 200 with missing list)", %{conn: conn} do
    ensure_parts_pricing_tables!()
    :rand.seed(:exsss, {4, 5, 6})

    owner_id = Ecto.UUID.generate()
    vehicle_id = Ecto.UUID.generate()
    work_order_id = Ecto.UUID.generate()

    insert_auth_user!(owner_id)
    make = "Ford"
    model = "Mustang"
    year = 1967
    insert_vehicle!(vehicle_id, owner_id, make, model, year)
    mailbox_id = get_vehicle_mailbox_id!(vehicle_id)
    grant_mailbox_access!(mailbox_id, owner_id, "owner")
    insert_work_order!(work_order_id, vehicle_id, owner_id)

    # 1) All missing -> 409
    conn =
      conn
      |> recycle()
      |> assign(:current_user_id, owner_id)
      |> MailboxController.assemble_work_order_quote(%{
        "vehicle_id" => vehicle_id,
        "work_order_id" => work_order_id,
        "part_queries" => ["__MISSING_A__", "__MISSING_B__"]
      })

    body = json_response(conn, 409)
    assert body["message"] == "No priced parts found for these queries"
    assert Enum.sort(body["data"]["missing"]) == ["__MISSING_A__", "__MISSING_B__"]

    # 2) Partial missing -> 200 with missing list present
    dsr_id = Ecto.UUID.generate()

    Repo.query!(
      """
      insert into public.data_source_registry (id, source_name, source_url, reliability_score)
      values ($1, 'Provider MissingSim', 'https://example.com/miss', 0.8)
      on conflict (id) do nothing
      """,
      [uuidb(dsr_id)]
    )

    priced_query = "priced item 1"

    insert_pricing!(%{
      id: Ecto.UUID.generate(),
      supplier_source_id: dsr_id,
      supplier_name: "Provider MissingSim",
      supplier_url: "https://example.com/miss/p1",
      component_name: priced_query,
      part_description: "Priced",
      part_number: "PN-MISS-1",
      currency: "USD",
      in_stock: true,
      lead_time_days: 1,
      price: Decimal.new("10.00"),
      make: make,
      year_start: 1960,
      year_end: 1970
    })

    conn =
      conn
      |> recycle()
      |> assign(:current_user_id, owner_id)
      |> MailboxController.assemble_work_order_quote(%{
        "vehicle_id" => vehicle_id,
        "work_order_id" => work_order_id,
        "part_queries" => [priced_query, "__MISSING_C__"]
      })

    body = json_response(conn, 200)
    assert body["status"] == "success"

    assembled = body["data"]["assembled"]
    assert assembled["missing"] == ["__MISSING_C__"]
    assert length(assembled["line_items"]) == 1
    assert get_in(assembled, ["line_items", Access.at(0), "query"]) == priced_query

    quote = body["data"]["quote"]
    assert quote["amount_cents"] == 1000
    assert quote["parts_cents"] == 1000
  end

  test "simulation: multi-line quote totals add up and each query selects expected best", %{conn: conn} do
    ensure_parts_pricing_tables!()
    :rand.seed(:exsss, {7, 8, 9})

    owner_id = Ecto.UUID.generate()
    vehicle_id = Ecto.UUID.generate()
    work_order_id = Ecto.UUID.generate()

    insert_auth_user!(owner_id)
    make = "Ford"
    model = "Mustang"
    year = 1967
    insert_vehicle!(vehicle_id, owner_id, make, model, year)
    mailbox_id = get_vehicle_mailbox_id!(vehicle_id)
    grant_mailbox_access!(mailbox_id, owner_id, "owner")
    insert_work_order!(work_order_id, vehicle_id, owner_id)

    dsr_id = Ecto.UUID.generate()

    Repo.query!(
      """
      insert into public.data_source_registry (id, source_name, source_url, reliability_score)
      values ($1, 'Provider Multi', 'https://example.com/multi', 0.9)
      on conflict (id) do nothing
      """,
      [uuidb(dsr_id)]
    )

    # Use non-overlapping query tokens to avoid substring collisions under ilike %query%.
    # Example: "multi_q_1__token" does NOT match "multi_q_12__token".
    token = Ecto.UUID.generate()
    queries = Enum.map(1..12, fn i -> "multi_q_#{i}__#{token}" end)

    expected_per_query =
      Enum.reduce(queries, %{}, fn q, acc ->
        # For each query, create 3 candidates; compute expected best using same ordering.
        candidates =
          Enum.map(1..3, fn j ->
            %{
              id: Ecto.UUID.generate(),
              supplier_source_id: dsr_id,
              supplier_name: "Provider Multi",
              supplier_url: "https://example.com/multi/#{q}/#{j}",
              component_name: q,
              part_description: "Desc #{j}",
              part_number: "PN-MULTI-#{q}-#{j}",
              currency: "USD",
              in_stock: :rand.uniform(2) == 1,
              lead_time_days: Enum.random([nil, 1, 2, 3, 5]),
              price: Decimal.new("#{Enum.random(10..80)}.00"),
              make: make,
              year_start: 1960,
              year_end: 1970
            }
          end)

        Enum.each(candidates, &insert_pricing!/1)
        best = expected_best(candidates)
        Map.put(acc, q, best)
      end)

    conn =
      conn
      |> recycle()
      |> assign(:current_user_id, owner_id)
      |> MailboxController.assemble_work_order_quote(%{
        "vehicle_id" => vehicle_id,
        "work_order_id" => work_order_id,
        "part_queries" => queries
      })

    body = json_response(conn, 200)
    assembled = body["data"]["assembled"]
    assert assembled["missing"] == []
    assert length(assembled["line_items"]) == length(queries)

    # Verify each selected is expected
    Enum.each(assembled["line_items"], fn li ->
      q = li["query"]
      expected = Map.fetch!(expected_per_query, q)
      selected = li["selected"]
      assert selected["part_number"] == expected.part_number
      assert selected["supplier_url"] == expected.supplier_url
    end)

    # Verify totals equal sum of selected price_cents
    expected_cents =
      assembled["line_items"]
      |> Enum.map(fn li -> li["selected"]["price_cents"] end)
      |> Enum.sum()

    quote = body["data"]["quote"]
    assert quote["amount_cents"] == expected_cents
    assert quote["parts_cents"] == expected_cents
  end

  test "simulation: adversarial candidates (null lead time, null price, conflicting stock) keeps stable ordering", %{conn: conn} do
    ensure_parts_pricing_tables!()

    owner_id = Ecto.UUID.generate()
    vehicle_id = Ecto.UUID.generate()
    work_order_id = Ecto.UUID.generate()

    insert_auth_user!(owner_id)
    make = "Ford"
    model = "Mustang"
    year = 1967
    insert_vehicle!(vehicle_id, owner_id, make, model, year)
    mailbox_id = get_vehicle_mailbox_id!(vehicle_id)
    grant_mailbox_access!(mailbox_id, owner_id, "owner")
    insert_work_order!(work_order_id, vehicle_id, owner_id)

    dsr_id = Ecto.UUID.generate()

    Repo.query!(
      """
      insert into public.data_source_registry (id, source_name, source_url, reliability_score)
      values ($1, 'Provider Adv', 'https://example.com/adv', 0.5)
      on conflict (id) do nothing
      """,
      [uuidb(dsr_id)]
    )

    q = "adversarial query"

    # Candidate A: in stock true, lead_time nil (treated as 999), cheap
    insert_pricing!(%{
      id: Ecto.UUID.generate(),
      supplier_source_id: dsr_id,
      supplier_name: "Provider Adv",
      supplier_url: "https://example.com/adv/a",
      component_name: q,
      part_description: "A",
      part_number: "ADV-A",
      currency: "USD",
      in_stock: true,
      lead_time_days: nil,
      price: Decimal.new("10.00"),
      make: make,
      year_start: 1960,
      year_end: 1970
    })

    # Candidate B: in stock true, lead_time 2, more expensive -> should win due to lead_time ordering
    insert_pricing!(%{
      id: Ecto.UUID.generate(),
      supplier_source_id: dsr_id,
      supplier_name: "Provider Adv",
      supplier_url: "https://example.com/adv/b",
      component_name: q,
      part_description: "B",
      part_number: "ADV-B",
      currency: "USD",
      in_stock: true,
      lead_time_days: 2,
      price: Decimal.new("20.00"),
      make: make,
      year_start: 1960,
      year_end: 1970
    })

    # Candidate C: out of stock, lead_time 1, cheapest -> should lose because out_of_stock
    insert_pricing!(%{
      id: Ecto.UUID.generate(),
      supplier_source_id: dsr_id,
      supplier_name: "Provider Adv",
      supplier_url: "https://example.com/adv/c",
      component_name: q,
      part_description: "C",
      part_number: "ADV-C",
      currency: "USD",
      in_stock: false,
      lead_time_days: 1,
      price: Decimal.new("1.00"),
      make: make,
      year_start: 1960,
      year_end: 1970
    })

    conn =
      conn
      |> recycle()
      |> assign(:current_user_id, owner_id)
      |> MailboxController.assemble_work_order_quote(%{
        "vehicle_id" => vehicle_id,
        "work_order_id" => work_order_id,
        "part_queries" => [q]
      })

    body = json_response(conn, 200)
    selected = get_in(body, ["data", "assembled", "line_items", Access.at(0), "selected"])
    assert selected["part_number"] == "ADV-B"
    assert selected["supplier_url"] == "https://example.com/adv/b"
  end
end


