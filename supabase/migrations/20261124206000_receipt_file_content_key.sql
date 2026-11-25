-- One content key for a receipt's stored file, read by the duplicate trigger: the same bytes uploaded twice are one paper.
--
-- Measured 2026-11-25 (scripts/data/q.sh, storage.objects): after 20261124204000 (same file_url -> duplicate_of), the
-- itemise fold (20261124203000) still held 26 live readings as 'held_same_file_sibling' (same custodian, same original
-- file name, same car) that the trigger left live, because each is a separate stored object. 25 of the 26 are
-- byte-identical to their sibling: same storage eTag and same size. They stayed live as papers with 0 lines, so the paper
-- counted twice.
--
--   receipts.file_content_key text: '<eTag>:<size>' of the storage object receipts.file_url names, read from
--     storage.objects. NULL when the file is not in storage (2,175 older rows point at laptop file:// paths) or not found.
--     Of 338 storage-backed receipts, 338 resolve (83 of 83 created in the last 30 days).
--   receipt_file_content_key_set (BEFORE INSERT OR UPDATE OF file_url, file_content_key; SECURITY DEFINER because
--     signed-in uploaders cannot read every storage object): the key is always the storage answer, never a caller's.
--     It is named to fire before trg_receipts_flag_duplicate (BEFORE triggers run in name order).
--   receipts_flag_duplicate(): after the content-key and same-file_url rules, a reading that is not superseded and
--     still not a duplicate becomes a duplicate of an EARLIER live reading of the same custodian with the same content
--     key ('auto: same stored bytes uploaded again'). The trigger also fires on file_content_key.
--   Backfill, first: for each custodian x content key with more than one live reading, the canonical reading is the one
--     that carries receipt_items, else the earliest; the others get duplicate_of = canonical (duplicate_run_id
--     'receipt_same_bytes_20261125'). The existing triggers stamp is_superseded and hold their vehicle links. Then every
--     storage-backed receipt gets its key. Asserts: no reading with lines is marked, the linked count falls by exactly
--     the marked readings' links, and every marked linked reading's canonical is linked to the same vehicle.
-- The fold's file-name hold stays: holding lines needs only suspicion, removing a paper from the counts needs proof.
-- Contract: supabase/sql/test_receipt_file_content_key.sql (PG17). Revert: supabase/sql/revert_20261124206000_receipt_file_content_key.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.receipts ADD COLUMN IF NOT EXISTS file_content_key text;
COMMENT ON COLUMN public.receipts.file_content_key IS 'eTag:size of the storage object file_url names (storage.objects), set by receipt_file_content_key_set. Same custodian + same key = the same bytes = one paper (receipts_flag_duplicate). NULL = not in storage.';
CREATE INDEX IF NOT EXISTS receipts_user_file_content_key_idx ON public.receipts (user_id, file_content_key) WHERE file_content_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.receipt_file_content_key(p_file_url text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT (o.metadata->>'eTag') || ':' || (o.metadata->>'size')
    FROM storage.objects o
   WHERE p_file_url ~ '/storage/v1/object/(public|sign|authenticated)/[^/]+/'
     AND o.bucket_id = substring(p_file_url FROM '/storage/v1/object/(?:public|sign|authenticated)/([^/]+)/')
     AND o.name = substring(p_file_url FROM '/storage/v1/object/(?:public|sign|authenticated)/[^/]+/([^?]+)')
     AND nullif(o.metadata->>'eTag', '') IS NOT NULL
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.receipt_file_content_key(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.receipt_file_content_key_set()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.file_content_key := public.receipt_file_content_key(NEW.file_url);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.receipt_file_content_key_set() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS receipt_file_content_key_set ON public.receipts;
CREATE TRIGGER receipt_file_content_key_set BEFORE INSERT OR UPDATE OF file_url, file_content_key ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.receipt_file_content_key_set();

CREATE OR REPLACE FUNCTION public.receipts_flag_duplicate()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.content_key := public.receipt_content_key(new.user_id, new.vendor_name, coalesce(new.total_amount, new.total), new.file_name);
  if new.duplicate_of is null and new.content_key is not null then
    select r.id into new.duplicate_of from public.receipts r
     where r.content_key = new.content_key and r.id <> new.id and r.duplicate_of is null
     order by r.created_at, r.id limit 1;
    if new.duplicate_of is not null then
      new.duplicate_reason := coalesce(new.duplicate_reason, 'auto: same user, vendor, amount and original file name');
    end if;
  end if;
  -- The same stored file read again (amounts or vendor may disagree between readings): the earlier live reading stands.
  if new.duplicate_of is null and coalesce(new.file_url, '') <> '' then
    select r.id into new.duplicate_of from public.receipts r
     where r.file_url = new.file_url and r.id <> new.id and r.user_id is not distinct from new.user_id
       and r.duplicate_of is null and r.is_superseded is not true
       and (r.created_at, r.id) < (coalesce(new.created_at, now()), new.id)
     order by r.created_at, r.id limit 1;
    if new.duplicate_of is not null then
      new.duplicate_reason := coalesce(new.duplicate_reason, 'auto: same stored file read again');
    end if;
  end if;
  -- The same bytes uploaded again as a new object: the earlier live reading stands.
  if new.duplicate_of is null and new.file_content_key is not null and new.is_superseded is not true then
    select r.id into new.duplicate_of from public.receipts r
     where r.file_content_key = new.file_content_key and r.id <> new.id and r.user_id is not distinct from new.user_id
       and r.duplicate_of is null and r.is_superseded is not true
       and (r.created_at, r.id) < (coalesce(new.created_at, now()), new.id)
     order by r.created_at, r.id limit 1;
    if new.duplicate_of is not null then
      new.duplicate_reason := coalesce(new.duplicate_reason, 'auto: same stored bytes uploaded again');
    end if;
  end if;
  if new.duplicate_of is not null and coalesce(new.is_superseded,false) = false then
    -- superseded_by points at payment_events, so the canonical receipt id goes in superseded_reason instead
    new.is_superseded := true;
    new.superseded_at := coalesce(new.superseded_at, now()); new.superseded_reason := coalesce(new.superseded_reason, 'duplicate_of '||new.duplicate_of::text);
  end if;
  return new;
end $function$;

DROP TRIGGER IF EXISTS trg_receipts_flag_duplicate ON public.receipts;
CREATE TRIGGER trg_receipts_flag_duplicate BEFORE INSERT OR UPDATE OF user_id, vendor_name, total_amount, total, file_name, file_url, file_content_key, duplicate_of
  ON public.receipts FOR EACH ROW EXECUTE FUNCTION public.receipts_flag_duplicate();

DO $$
DECLARE n_dup int; n_groups int; n_linked_before int; n_linked_after int; n_expected_lost int; n_lines_marked int; n_orphaned int; n_keyed int;
BEGIN
  CREATE TEMP TABLE same_bytes ON COMMIT DROP AS
  WITH live AS (
    SELECT r.id, r.user_id, r.created_at, public.receipt_file_content_key(r.file_url) AS k,
           EXISTS (SELECT 1 FROM public.receipt_items i WHERE i.receipt_id = r.id) AS has_lines
      FROM public.receipts r
     WHERE r.duplicate_of IS NULL AND r.is_superseded IS NOT TRUE AND r.file_url ~ '/storage/v1/object/'),
  ranked AS (
    SELECT live.*, row_number() OVER (PARTITION BY user_id, k ORDER BY has_lines DESC, created_at, id) AS rn,
           count(*) OVER (PARTITION BY user_id, k) AS n
      FROM live WHERE k IS NOT NULL)
  SELECT d.id, c.id AS canonical_id, d.has_lines
    FROM ranked d JOIN ranked c ON c.user_id IS NOT DISTINCT FROM d.user_id AND c.k = d.k AND c.rn = 1
   WHERE d.n > 1 AND d.rn > 1;

  SELECT count(*), count(DISTINCT canonical_id), count(*) FILTER (WHERE has_lines) INTO n_dup, n_groups, n_lines_marked FROM same_bytes;
  IF n_lines_marked > 0 THEN
    RAISE EXCEPTION 'same-bytes duplicates: % readings with lines would be marked', n_lines_marked;
  END IF;
  SELECT count(*) INTO n_orphaned FROM same_bytes s
   WHERE EXISTS (SELECT 1 FROM public.receipt_vehicle_links l WHERE l.receipt_id = s.id AND l.status = 'linked' AND l.retired_at IS NULL
                  AND NOT EXISTS (SELECT 1 FROM public.receipt_vehicle_links c WHERE c.receipt_id = s.canonical_id AND c.vehicle_id = l.vehicle_id
                                   AND c.status = 'linked' AND c.retired_at IS NULL));
  IF n_orphaned > 0 THEN
    RAISE EXCEPTION 'same-bytes duplicates: % readings would take a paper off a vehicle', n_orphaned;
  END IF;
  SELECT count(DISTINCT l.receipt_id) INTO n_linked_before FROM public.receipt_vehicle_links l WHERE l.status = 'linked' AND l.retired_at IS NULL;
  SELECT count(DISTINCT l.receipt_id) INTO n_expected_lost FROM public.receipt_vehicle_links l JOIN same_bytes s ON s.id = l.receipt_id
   WHERE l.status = 'linked' AND l.retired_at IS NULL;

  UPDATE public.receipts r
     SET duplicate_of = s.canonical_id,
         duplicate_reason = 'same stored bytes (storage eTag and size) uploaded more than once; canonical = the reading that carries lines, else the earliest',
         duplicate_run_id = 'receipt_same_bytes_20261125'
    FROM same_bytes s
   WHERE r.id = s.id AND r.duplicate_of IS NULL;

  -- Every storage-backed receipt gets its key; receipt_file_content_key_set computes it.
  UPDATE public.receipts r SET file_content_key = NULL
   WHERE r.file_url ~ '/storage/v1/object/' AND r.file_content_key IS DISTINCT FROM public.receipt_file_content_key(r.file_url);
  SELECT count(*) INTO n_keyed FROM public.receipts WHERE file_content_key IS NOT NULL;

  SELECT count(DISTINCT l.receipt_id) INTO n_linked_after FROM public.receipt_vehicle_links l WHERE l.status = 'linked' AND l.retired_at IS NULL;
  IF n_linked_after <> n_linked_before - n_expected_lost THEN
    RAISE EXCEPTION 'same-bytes duplicates: linked receipts % -> %, expected %', n_linked_before, n_linked_after, n_linked_before - n_expected_lost;
  END IF;
  RAISE NOTICE 'same-bytes duplicates: % readings of % files marked; % receipts keyed; linked receipts % -> %',
    n_dup, n_groups, n_keyed, n_linked_before, n_linked_after;
END $$;

COMMIT;
