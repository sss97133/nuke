BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. image_count = gallery-eligible photos (same definition as the public gallery / evidence key)
CREATE OR REPLACE FUNCTION public.update_vehicle_image_count()
 RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE ids uuid[] := ARRAY[]::uuid[]; v uuid; n int;
BEGIN
  IF current_setting('app.skip_image_count_trigger', true) = '1' THEN RETURN NULL; END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.vehicle_id IS NOT NULL THEN ids := ids || NEW.vehicle_id; END IF;
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.vehicle_id IS NOT NULL AND NOT (OLD.vehicle_id = ANY(ids)) THEN ids := ids || OLD.vehicle_id; END IF;
  FOREACH v IN ARRAY ids LOOP
    SELECT count(*) INTO n FROM public.vehicle_images i
     WHERE i.vehicle_id = v AND public.vehicle_image_gallery_eligible(i);
    UPDATE public.vehicles SET image_count = n WHERE id = v AND image_count IS DISTINCT FROM n;
  END LOOP;
  RETURN NULL;
END $f$;

CREATE OR REPLACE FUNCTION public.update_vehicle_image_count_stmt()
 RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  UPDATE public.vehicles v
     SET image_count = c.n
    FROM (SELECT n0.vehicle_id, (SELECT count(*) FROM public.vehicle_images i
                                  WHERE i.vehicle_id = n0.vehicle_id AND public.vehicle_image_gallery_eligible(i)) AS n
            FROM (SELECT DISTINCT vehicle_id FROM new_rows WHERE vehicle_id IS NOT NULL) n0) c
   WHERE v.id = c.vehicle_id AND v.image_count IS DISTINCT FROM c.n;
  RETURN NULL;
END $f$;

-- eligibility also changes when the vision gate / document / match / approval state changes (these were uncounted before)
DROP TRIGGER IF EXISTS trg_vehicle_images_count_gate ON public.vehicle_images;
CREATE TRIGGER trg_vehicle_images_count_gate
  AFTER UPDATE OF vision_gate_status, is_document, image_vehicle_match_status, is_approved, approval_status ON public.vehicle_images
  FOR EACH ROW WHEN (OLD.vision_gate_status IS DISTINCT FROM NEW.vision_gate_status
                  OR OLD.is_document IS DISTINCT FROM NEW.is_document
                  OR OLD.image_vehicle_match_status IS DISTINCT FROM NEW.image_vehicle_match_status
                  OR OLD.is_approved IS DISTINCT FROM NEW.is_approved
                  OR OLD.approval_status IS DISTINCT FROM NEW.approval_status)
  EXECUTE FUNCTION public.update_vehicle_image_count();

-- 2. derived-text/valuation functions count gallery-eligible photos only; auto-generated highlights can be regenerated
CREATE OR REPLACE FUNCTION public.synthesize_profile_from_vision(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_mods text[];
  v_damage text[];
  v_mod_text text;
  v_flaw_text text;
  v_highlight_text text;
  v_avg_condition numeric;
  v_photo_count int;
  v_zone_count int;
  v_updated_fields text[] := ARRAY[]::text[];
  v_current record;
BEGIN
  SELECT modifications, known_flaws, highlights, condition_rating
  INTO v_current
  FROM vehicles WHERE id = p_vehicle_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'vehicle not found');
  END IF;

  -- Aggregate modification flags
  SELECT array_agg(flag ORDER BY cnt DESC)
  INTO v_mods
  FROM (
    SELECT replace(initcap(replace(flag, '_', ' ')), 'Aftermarket ', '') as flag, count(*) as cnt
    FROM vehicle_images, unnest(modification_flags) as flag
    WHERE vehicle_id = p_vehicle_id
      AND is_duplicate IS NOT TRUE AND public.vehicle_image_gallery_eligible(vehicle_images)
      AND modification_flags IS NOT NULL AND modification_flags != '{}'
    GROUP BY flag
    HAVING count(*) >= 2
    ORDER BY count(*) DESC
    LIMIT 20
  ) sub;

  -- Aggregate damage flags by zone
  SELECT array_agg(zone_damage)
  INTO v_damage
  FROM (
    SELECT
      initcap(replace(vi.vehicle_zone, '_', ' ')) || ': ' ||
      string_agg(DISTINCT replace(initcap(replace(flag, '_', ' ')), 'Uv ', 'UV '), ', ')
      as zone_damage
    FROM vehicle_images vi, unnest(vi.damage_flags) as flag
    WHERE vi.vehicle_id = p_vehicle_id
      AND vi.is_duplicate IS NOT TRUE AND public.vehicle_image_gallery_eligible(vi)
      AND vi.damage_flags IS NOT NULL AND vi.damage_flags != '{}'
      AND flag NOT IN ('dust_accumulation', 'dirt_accumulation', 'grime_accumulation')
      AND vi.vehicle_zone IS NOT NULL
    GROUP BY vi.vehicle_zone
    HAVING count(DISTINCT flag) >= 2
    ORDER BY count(*) DESC
    LIMIT 10
  ) sub;

  -- Zone coverage
  SELECT count(DISTINCT vehicle_zone), count(*)
  INTO v_zone_count, v_photo_count
  FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id
    AND is_duplicate IS NOT TRUE AND public.vehicle_image_gallery_eligible(vehicle_images)
    AND vehicle_zone IS NOT NULL;

  -- Average condition
  SELECT round(avg(condition_score), 1)
  INTO v_avg_condition
  FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id
    AND is_duplicate IS NOT TRUE AND public.vehicle_image_gallery_eligible(vehicle_images)
    AND condition_score IS NOT NULL;

  -- Write modifications (only if NULL)
  IF v_current.modifications IS NULL AND v_mods IS NOT NULL AND array_length(v_mods, 1) > 0 THEN
    v_mod_text := array_to_string(v_mods, E'\n');
    UPDATE vehicles SET modifications = v_mod_text, updated_at = now() WHERE id = p_vehicle_id;
    v_updated_fields := array_append(v_updated_fields, 'modifications');
  END IF;

  -- Write known_flaws (only if NULL)
  IF v_current.known_flaws IS NULL AND v_damage IS NOT NULL AND array_length(v_damage, 1) > 0 THEN
    v_flaw_text := array_to_string(v_damage, E'\n');
    UPDATE vehicles SET known_flaws = v_flaw_text, updated_at = now() WHERE id = p_vehicle_id;
    v_updated_fields := array_append(v_updated_fields, 'known_flaws');
  END IF;

  -- Write highlights (only if NULL or previously auto-generated)
  -- regenerate only text this function itself produced (never owner/BaT-authored highlights)
  IF (v_current.highlights IS NULL OR v_current.highlights ~ '^[0-9]+ photos across [0-9]+ documented zones') AND v_zone_count >= 3 THEN
    v_highlight_text := v_photo_count || ' photos across ' || v_zone_count || ' documented zones';
    IF v_mods IS NOT NULL AND array_length(v_mods, 1) > 0 THEN
      v_highlight_text := v_highlight_text || E'\n' || array_length(v_mods, 1) || ' modifications identified from photo evidence';
    END IF;
    UPDATE vehicles SET highlights = v_highlight_text, updated_at = now() WHERE id = p_vehicle_id;
    v_updated_fields := array_append(v_updated_fields, 'highlights');
  END IF;

  -- Set condition_rating (only if NULL)
  IF v_current.condition_rating IS NULL AND v_avg_condition IS NOT NULL THEN
    UPDATE vehicles SET condition_rating = least(10, greatest(1, round(v_avg_condition * 2)::int)), updated_at = now()
    WHERE id = p_vehicle_id;
    v_updated_fields := array_append(v_updated_fields, 'condition_rating');
  END IF;

  -- Recompute ARS
  IF array_length(v_updated_fields, 1) > 0 THEN
    BEGIN
      PERFORM persist_auction_readiness(p_vehicle_id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'updated_fields', to_jsonb(v_updated_fields),
    'modifications_count', coalesce(array_length(v_mods, 1), 0),
    'damage_zones', coalesce(array_length(v_damage, 1), 0),
    'photo_count', v_photo_count,
    'zone_count', v_zone_count,
    'avg_condition', v_avg_condition
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.compute_vehicle_value(p_vehicle_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  img_count int := 0;
  approved_img_count int := 0;
  tag_count int := 0;
  recent_events int := 0;
  receipts_total numeric := 0;
  verified_owner boolean := false;
  contrib_count int := 0;
  public_flag boolean := true;
  completeness numeric := 0;
  score numeric := 0;
begin
  -- gallery-eligible photos only (same definition as vehicles.image_count and the public gallery)
  select count(*), count(*) filter (where coalesce(vi.is_approved, true))
    into img_count, approved_img_count
  from public.vehicle_images vi
  where vi.vehicle_id = p_vehicle_id and public.vehicle_image_gallery_eligible(vi);

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='image_tags') then
    select count(*) into tag_count
    from public.image_tags t
    join public.vehicle_images vi on vi.id = t.image_id
    where vi.vehicle_id = p_vehicle_id;
  end if;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='timeline_events') then
    select count(*) into recent_events
    from public.timeline_events
    where vehicle_id = p_vehicle_id
      and created_at >= now() - interval '30 days';
  else
    recent_events := 0;
  end if;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='receipts') then
    select coalesce(sum(total_amount), 0) into receipts_total
    from public.receipts
    where scope_type = 'vehicle' and duplicate_of is null and amount_check in ('verified','plausible')
      and scope_id::text = p_vehicle_id::text
      and coalesce(processing_status, 'parsed') in ('parsed','validated','saved');
  else
    receipts_total := 0;
  end if;

  select coalesce(is_public, true) into public_flag
  from (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item') v where v.id = p_vehicle_id;

  select (
    (case when (v.make is not null and v.make <> '') then 1 else 0 end) +
    (case when (v.model is not null and v.model <> '') then 1 else 0 end) +
    (case when v.year is not null then 1 else 0 end) +
    (case when (v.vin is not null and v.vin <> '') then 1 else 0 end) +
    (case when (v.color is not null and v.color <> '') then 1 else 0 end) +
    (case when (v.engine_size is not null) then 1 else 0 end) +
    (case when (v.transmission is not null and v.transmission <> '') then 1 else 0 end)
  ) / 7.0
  into completeness
  from (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item') v where v.id = p_vehicle_id;

  score := 0;
  score := score + LEAST(40, COALESCE(ln(GREATEST(2, approved_img_count)) * 20, 0));
  score := score + LEAST(15, (tag_count / 50.0) * 15);
  score := score + LEAST(15, (recent_events / 10.0) * 15);
  score := score + LEAST(15, (receipts_total / 5000.0) * 15);
  if verified_owner then score := score + 10; end if;
  score := score + LEAST(5, contrib_count);
  if public_flag then score := score + 5; end if;
  score := score + LEAST(10, GREATEST(0, completeness * 10));

  update public.vehicles set value_score = round(score::numeric, 2),
    value_breakdown = jsonb_build_object(
      'approved_images', approved_img_count,
      'tags', tag_count,
      'recent_events_30d', recent_events,
      'receipts_total', receipts_total,
      'verified_owner', verified_owner,
      'contributors', contrib_count,
      'public', public_flag,
      'completeness', completeness,
      'computed_at', now()
    )
  where id = p_vehicle_id;

  return score;
end $function$;

-- 3. logged, revertible refresh of derived columns (re-runs the existing valuation path)
CREATE OR REPLACE FUNCTION public.profile_fix_refresh_derived_v1(p_vehicle uuid, p_dry boolean DEFAULT true, p_run uuid DEFAULT gen_random_uuid())
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE b jsonb; a jsonb; k text; n int; acts jsonb := '[]'::jsonb; syn jsonb;
BEGIN
  SELECT to_jsonb(v) INTO b FROM public.vehicles v WHERE v.id = p_vehicle;
  IF b IS NULL THEN RETURN jsonb_build_object('error','vehicle not found'); END IF;
  SELECT count(*) INTO n FROM public.vehicle_images i WHERE i.vehicle_id = p_vehicle AND public.vehicle_image_gallery_eligible(i);
  IF p_dry THEN
    RETURN jsonb_build_object('run_id', p_run, 'dry_run', true, 'image_count_before', b->'image_count', 'image_count_after', n,
                              'note', 'valuation/highlights are computed by compute_vehicle_value + synthesize_profile_from_vision on apply');
  END IF;
  UPDATE public.vehicles SET image_count = n WHERE id = p_vehicle AND image_count IS DISTINCT FROM n;
  PERFORM public.compute_vehicle_value(p_vehicle);
  syn := public.synthesize_profile_from_vision(p_vehicle);
  SELECT to_jsonb(v) INTO a FROM public.vehicles v WHERE v.id = p_vehicle;
  FOR k IN SELECT key FROM jsonb_each(a) WHERE key <> 'updated_at' AND (b->key) IS DISTINCT FROM (a->key) LOOP
    INSERT INTO public.profile_fix_log(run_id, rule, vehicle_id, target_table, target_pk, column_name, op, before, after, evidence)
    VALUES (p_run, 'refresh_derived', p_vehicle, 'vehicles', p_vehicle, k, 'update', coalesce(b->k,'null'::jsonb), coalesce(a->k,'null'::jsonb),
            jsonb_build_object('via','compute_vehicle_value+synthesize_profile_from_vision','gallery_eligible_images', n));
    acts := acts || jsonb_build_object('column', k, 'before', b->k, 'after', a->k);
  END LOOP;
  RETURN jsonb_build_object('run_id', p_run, 'dry_run', false, 'changes', acts, 'synthesize', syn);
END $f$;
REVOKE EXECUTE ON FUNCTION public.profile_fix_refresh_derived_v1(uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
