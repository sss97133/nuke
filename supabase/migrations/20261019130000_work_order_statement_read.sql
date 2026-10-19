-- Work-order statement reader under the privacy doctrine (owner, 2026-10-18; statement access = "everyone who needs
-- to", refined by open data). Replaces the statement page's use of resolve_work_order_status (service-only since
-- 20261019054333), which searched customer names and e-mail-like text and returned customer contact fields.
--
-- work_order_statement_read(p_work_order_id, p_vehicle_id, p_handle): exactly one lookup key.
--   * work order id -> that work order's vehicle statement (or the single work order when it has no vehicle);
--     vehicle id -> that vehicle; handle -> the public profile's work orders as customer (one vehicle: its
--     statement; several: a list of vehicles to choose). No name, e-mail or free-text search; every lookup is an
--     index probe, so a miss returns immediately.
--   * Open: vehicle (year/make/model/trim/VIN), work orders with display titles, parts and labor lines with
--     prices, rates and costs, parts/labor/goodwill totals, the shop's public face (name, website, city, state,
--     logo, tax rate).
--   * Parties only (customer, org_owner, performer on that work order): payments, payments total, balance due,
--     the shop's payment instructions and free-text notes. Non-parties get null with a visibility marker.
--   * Withheld from everyone: customer name/e-mail/phone, shop e-mail/phone/street address/zip/legal name. Contact
--     is a placeholder action {action:'contact_via_nuke', available:false}; no messaging is sent from here.
--   * Work orders on a vehicle whose owner set is_public = false appear only to viewers holding a slot.
-- Contract: supabase/sql/test_work_order_statement_read.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.work_order_statement_read(p_work_order_id uuid DEFAULT NULL, p_vehicle_id uuid DEFAULT NULL,
  p_handle text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  vid uuid;
  solo uuid;
  handle_user uuid;
  vehicle_open boolean;
  wos jsonb;
  shop jsonb;
  v jsonb;
  any_party boolean;
  all_party boolean;
  all_slots text[];
BEGIN
  IF num_nonnulls(p_work_order_id, p_vehicle_id, NULLIF(btrim(p_handle), '')) <> 1 THEN
    RAISE EXCEPTION 'Exactly one of work order id, vehicle id or handle is required' USING ERRCODE = '22023';
  END IF;
  IF p_work_order_id IS NOT NULL THEN
    SELECT w.vehicle_id INTO vid FROM public.work_orders w WHERE w.id = p_work_order_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'no_match', 'lookup', 'work_order_id'); END IF;
    IF vid IS NULL THEN solo := p_work_order_id; END IF;
  ELSIF p_vehicle_id IS NOT NULL THEN
    vid := p_vehicle_id;
    IF NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id = vid) THEN
      RETURN jsonb_build_object('error', 'no_match', 'lookup', 'vehicle_id');
    END IF;
  ELSE
    SELECT p.id INTO handle_user FROM public.profiles p
      WHERE p.username_lower = lower(ltrim(btrim(p_handle), '@')) AND p.username IS NOT NULL AND char_length(p.username) > 0
        AND p.is_public IS TRUE;
    IF handle_user IS NULL THEN RETURN jsonb_build_object('error', 'no_match', 'lookup', 'handle'); END IF;
    WITH c AS (
      SELECT w.vehicle_id FROM public.work_orders w
      WHERE w.customer_id = handle_user AND w.vehicle_id IS NOT NULL AND public.work_order_vehicle_open(w.vehicle_id)
      GROUP BY w.vehicle_id
    )
    SELECT CASE WHEN count(*) = 1 THEN min(c.vehicle_id::text)::uuid END,
      COALESCE(jsonb_agg(jsonb_build_object('vehicle_id', c.vehicle_id, 'vehicle_label', (SELECT jsonb_build_object('year', vv.year,
        'make', vv.make, 'model', vv.model, 'trim', vv.trim, 'text', NULLIF(concat_ws(' ', vv.year, vv.make, vv.model, vv.trim), ''))
        FROM public.vehicles vv WHERE vv.id = c.vehicle_id)) ORDER BY c.vehicle_id), '[]'::jsonb)
      INTO vid, v FROM c;
    IF vid IS NULL THEN
      IF jsonb_array_length(v) = 0 THEN RETURN jsonb_build_object('error', 'no_match', 'lookup', 'handle'); END IF;
      RETURN jsonb_build_object('matches', v, 'lookup', 'handle',
        'viewer', public.job_reader_viewer('visitor', '{}', public.viewer_identity_bridge(uid), false));
    END IF;
  END IF;

  vehicle_open := public.work_order_vehicle_open(vid);
  WITH s AS (
    SELECT x.work_order_id, x.slots, public.job_reader_is_party(x.slots) AS party
    FROM public.work_order_viewer_slots(uid, solo, CASE WHEN solo IS NULL THEN vid END) x
    WHERE vehicle_open OR cardinality(x.slots) > 0
  ), lines AS (
    SELECT s.work_order_id, s.slots, s.party, w.created_at, w.status, w.notes,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'work_order_id', p.work_order_id, 'part_name', p.part_name,
          'part_number', p.part_number, 'brand', p.brand, 'category', p.category, 'quantity', p.quantity,
          'unit_price', p.unit_price, 'total_price', p.total_price, 'supplier', p.supplier, 'buy_url', p.buy_url,
          'status', p.status, 'ai_extracted', p.ai_extracted, 'user_verified', p.user_verified,
          'is_comped', COALESCE(p.is_comped, false), 'comp_reason', p.comp_reason, 'comp_retail_value', p.comp_retail_value,
          'is_taxable', p.is_taxable, 'notes', CASE WHEN s.party THEN p.notes END, 'created_at', p.created_at) ORDER BY p.created_at, p.id)
        FROM public.work_order_parts p WHERE p.work_order_id = s.work_order_id AND p.status IS DISTINCT FROM 'cancelled'), '[]'::jsonb) AS parts,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'work_order_id', l.work_order_id, 'task_name', l.task_name,
          'task_category', l.task_category, 'hours', l.hours, 'hourly_rate', l.hourly_rate, 'total_cost', l.total_cost,
          'rate_source', l.rate_source, 'status', l.status, 'ai_estimated', l.ai_estimated,
          'is_comped', COALESCE(l.is_comped, false), 'comp_reason', l.comp_reason, 'comp_retail_value', l.comp_retail_value,
          'notes', CASE WHEN s.party THEN l.notes END, 'created_at', l.created_at) ORDER BY l.created_at, l.id)
        FROM public.work_order_labor l WHERE l.work_order_id = s.work_order_id AND l.status IS DISTINCT FROM 'cancelled'), '[]'::jsonb) AS labor,
      CASE WHEN s.party THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'work_order_id', m.work_order_id, 'amount', m.amount,
          'payment_method', m.payment_method, 'sender_name', m.sender_name, 'memo', m.memo, 'reference_id', m.reference_id,
          'payment_date', m.payment_date, 'source', m.source, 'status', m.status, 'created_at', m.created_at) ORDER BY m.payment_date, m.id)
        FROM public.work_order_payments m WHERE m.work_order_id = s.work_order_id), '[]'::jsonb) END AS payments,
      (SELECT COALESCE(sum(COALESCE(p.total_price, p.unit_price * p.quantity)), 0) FROM public.work_order_parts p
        WHERE p.work_order_id = s.work_order_id AND COALESCE(p.is_comped, false) IS FALSE
          AND p.status IS DISTINCT FROM 'cancelled') AS parts_total,
      (SELECT COALESCE(sum(l.total_cost), 0) FROM public.work_order_labor l
        WHERE l.work_order_id = s.work_order_id AND COALESCE(l.is_comped, false) IS FALSE
          AND l.status IS DISTINCT FROM 'cancelled') AS labor_total,
      (SELECT COALESCE(sum(p.comp_retail_value), 0) FROM public.work_order_parts p WHERE p.work_order_id = s.work_order_id AND p.is_comped)
        + (SELECT COALESCE(sum(l.comp_retail_value), 0) FROM public.work_order_labor l WHERE l.work_order_id = s.work_order_id AND l.is_comped) AS comped_value,
      (SELECT COALESCE(sum(m.amount), 0) FROM public.work_order_payments m WHERE m.work_order_id = s.work_order_id AND m.status = 'completed') AS paid
    FROM s JOIN public.work_orders w ON w.id = s.work_order_id
  )
  SELECT COALESCE(jsonb_agg(public.work_order_open_header(l.work_order_id, l.party) || jsonb_build_object(
      'id', l.work_order_id, 'title', public.work_order_open_header(l.work_order_id, l.party)->'display_title',
      'status', l.status, 'created_at', l.created_at, 'slots', to_jsonb(l.slots), 'money_visible', l.party,
      'notes', CASE WHEN l.party THEN l.notes END,
      'parts', l.parts, 'labor', l.labor, 'payments', l.payments,
      'payments_visibility', CASE WHEN l.party THEN 'party' ELSE 'withheld_not_party' END,
      'parts_total', l.parts_total, 'labor_total', l.labor_total, 'comped_value', l.comped_value,
      'payments_total', CASE WHEN l.party THEN l.paid END,
      'balance_due', CASE WHEN l.party THEN l.parts_total + l.labor_total - l.paid END) ORDER BY l.created_at, l.work_order_id), '[]'::jsonb),
    bool_or(l.party), bool_and(l.party), ARRAY(SELECT DISTINCT unnest(x.slots) FROM lines x)
    INTO wos, any_party, all_party, all_slots FROM lines l;

  IF jsonb_array_length(wos) = 0 THEN RETURN jsonb_build_object('error', 'no_match', 'lookup', 'not_visible'); END IF;

  SELECT jsonb_build_object('name', COALESCE(o.name, o.business_name), 'website', o.website, 'city', o.city, 'state', o.state,
      'logo_url', o.logo_url, 'tax_rate', o.tax_rate,
      'payment_methods', CASE WHEN any_party THEN o.metadata->'payment_methods' END,
      'payment_methods_visibility', CASE WHEN any_party THEN 'party' ELSE 'withheld_not_party' END)
    INTO shop FROM public.work_orders w JOIN public.organizations o ON o.id = w.org_id
    WHERE w.id IN (SELECT (e->>'id')::uuid FROM jsonb_array_elements(wos) e) AND w.org_id IS NOT NULL
    ORDER BY w.created_at LIMIT 1;

  SELECT jsonb_build_object('id', vv.id, 'year', vv.year, 'make', vv.make, 'model', vv.model, 'trim', vv.trim, 'vin', vv.vin,
      'text', NULLIF(concat_ws(' ', vv.year, vv.make, vv.model, vv.trim), ''))
    INTO v FROM public.vehicles vv WHERE vv.id = vid;

  RETURN jsonb_build_object(
    'viewer', public.job_reader_viewer(public.job_reader_context(all_slots), all_slots, public.viewer_identity_bridge(uid), all_party)
      || jsonb_build_object('money_visible_basis', 'per work order'),
    'as_of', statement_timestamp(), 'vehicle', v, 'shop', shop,
    'contact', jsonb_build_object('action', 'contact_via_nuke', 'available', false,
      'basis', 'contact between users is brokered by Nuke; contact fields are never exposed'),
    'work_orders', wos,
    'totals', jsonb_build_object(
      'parts', (SELECT sum((e->>'parts_total')::numeric) FROM jsonb_array_elements(wos) e),
      'labor', (SELECT sum((e->>'labor_total')::numeric) FROM jsonb_array_elements(wos) e),
      'subtotal', (SELECT sum((e->>'parts_total')::numeric + (e->>'labor_total')::numeric) FROM jsonb_array_elements(wos) e),
      'goodwill', (SELECT sum((e->>'comped_value')::numeric) FROM jsonb_array_elements(wos) e),
      'payments', CASE WHEN all_party THEN (SELECT sum((e->>'payments_total')::numeric) FROM jsonb_array_elements(wos) e) END,
      'balance', CASE WHEN all_party THEN (SELECT sum((e->>'balance_due')::numeric) FROM jsonb_array_elements(wos) e) END),
    'coverage', jsonb_build_object('work_orders', jsonb_array_length(wos),
      'payments_withheld_on', (SELECT count(*) FROM jsonb_array_elements(wos) e WHERE NOT (e->>'money_visible')::boolean),
      'lookup', CASE WHEN p_work_order_id IS NOT NULL THEN 'work_order_id' WHEN p_vehicle_id IS NOT NULL THEN 'vehicle_id' ELSE 'handle' END,
      'population', CASE WHEN solo IS NOT NULL THEN 'one work order without a vehicle'
        WHEN vehicle_open THEN 'every work order on this vehicle' ELSE 'work orders on this private vehicle where the viewer holds a slot' END));
END $$;
REVOKE ALL ON FUNCTION public.work_order_statement_read(uuid, uuid, text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.work_order_statement_read(uuid, uuid, text) TO anon, authenticated;
COMMENT ON FUNCTION public.work_order_statement_read(uuid, uuid, text) IS 'Open work-order statement by work order id, vehicle id or public handle: parts/labor lines with prices and totals open; payments, balances, payment instructions and notes to parties only; no customer or shop contact fields (contact_via_nuke placeholder).';
NOTIFY pgrst, 'reload schema';
COMMIT;
