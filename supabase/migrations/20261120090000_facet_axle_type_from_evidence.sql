-- facet_axle_type_v1: the drivetrain panel's axle type item reads the shop paper and the photo readings already on file.
--
-- WHY. vehicle_facet_items listed drivetrain.axle.current.type as "missing: axle tag or limited-slip ID, or a receipt"
-- on a car that has a drivetrain shop invoice line reading "check and repair rear end posi ring pinion bearing and
-- axles" and two photographs of the rear cover whose printed tag reads "use limited slip diff. lube only". The fold
-- read the item only from the vehicle record (vehicles.rear_axle_type, empty). The paper lines are not keyed, and the
-- photo readings are reviewed_image_analysis_v1 rows with no claim role or property key, so the observation reader
-- never selected them. The page said "missing" while its own evidence named the answer.
--
-- WHAT CHANGES.
-- 1. axle_type_from_words(text, boolean): IMMUTABLE. Words to a short list: limited-slip (limited slip, posi, positraction,
--    LSD, traction-lok, sure-grip, safe-t-track, true-trac), locking (locker, spool) and open ("open diff", "open rear end").
--    A text naming more than one of them, or a negated unit ("non-posi"), gives NULL: never a guess. The second
--    argument false leaves "open" out (a photo cannot show an open carrier).
-- 2. vehicle_facet_norm gains the comparison kind 'axle_type' (those words, else the text as written), and the vehicle
--    record's rear_axle_type is compared in it, so a record "Posi" agrees with a shop's "posi" and does not conflict.
-- 3. axle_printed_words(text): the printed words as a source may show them: contacts redacted, dollar amounts and
--    comma-grouped sums removed, one line, 160 characters. A name inside a free-text line cannot be stripped mechanically.
--    vehicle_axle_type_evidence(vehicle): STABLE SECURITY DEFINER. Returns only the day, shop, normalized type, the
--    printed words and witness ids of (a) current shop work lines that receipt_line_system places in 'axle' and whose
--    words name a type (the same current-line selection as vehicle_machine_shop_lines: linked, not retired, receipt not
--    superseded or a duplicate, line date else page date else receipt date) and (b) reviewed_image_analysis_v1 readings
--    whose printed text regions or component labels name a limited-slip or locking unit AND that also name a
--    differential, axle or rear end among their components (a locker, a spool or a bottle of gear oil elsewhere in a
--    picture is not an axle reading). "open" counts only as a noun phrase, never as the verb ("open differential cover and
--    inspect"). A reader's notes are never scanned (they say what a photo does not prove). Visibility is the reconstruction's.
--    No amount, performer or contact. The helper returns an image as an id only: whether the viewer may be shown it is
--    decided in vehicle_facet_items, in the viewer's own role, as the other photo witnesses are.
-- 4. vehicle_facet_items gains one testimony branch in its `t` CTE for drivetrain.axle.current.type. Paper is a
--    'claim' with one source per shop (the shop's words). A photo is a 'reading' with its own source per image and the
--    limitation that a tag on a cover bolt is replaceable and does not prove the carrier. The reader's own rule then
--    decides the status: paper plus a photo are distinct sources of distinct reader families, so the item is
--    'established' only then; paper alone or photos alone stay claim / reading. It runs only for the drivetrain
--    dimension, the masthead and the whole read.
--
-- REVERT. Redefine vehicle_facet_items without the branch between facet_axle_type_v1 and facet_axle_type_v1_end and with
-- 'text' back in the rear_axle_type row, redefine vehicle_facet_norm without its 'axle_type' branch, then DROP FUNCTION
-- vehicle_axle_type_evidence(uuid), axle_printed_words(text) and axle_type_from_words(text, boolean). Nothing else is created, altered or
-- written; grants on vehicle_facet_items are kept by CREATE OR REPLACE.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.axle_type_from_words(p text, p_allow_open boolean DEFAULT true)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN n = 1 THEN CASE WHEN ls THEN 'limited-slip' WHEN lk THEN 'locking' ELSE 'open' END END
  FROM (
    SELECT ls, lk, op, (ls::int + lk::int + op::int) AS n
    FROM (
      SELECT s !~ '\y(non|no|not|without)[ -]+(posi|limited|lsd|locker|positrac|traction)' AND s ~
               '(limited[ -]?slip|\yposi\y|positrac|\ylsd\y|safe[ -]?t[ -]?track|sure[ -]?grip|traction[ -]?lok|trac[ -]?lok|true[ -]?trac)' AS ls,
             s !~ '\y(non|no|not|without)[ -]+(locker|spool)' AND s ~ '\y(locker|spool)\y' AS lk,
             -- "open" is a type only as a noun phrase: not "open differential cover", and not a line that says to look
             -- inside (inspect, check, drain, remove ...), where it is the verb.
             p_allow_open AND s ~ '\yopen[ -](diff|differential|carrier)\y'
               AND s !~ '\yopen[ -](diff|differential|carrier)\y[ ,-]*(cover|housing|case|and|&)'
               AND s !~ '\y(inspect|inspection|check|drain|remove|pull|clean|drop|unbolt)' AS op
      FROM (SELECT lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')) AS s) x) y) z
$$;
COMMENT ON FUNCTION public.axle_type_from_words(text, boolean) IS
  'Short axle type from printed words: limited-slip, locking or open; NULL when none, several, or a negated unit. A photo reading passes false so open is not read from a picture. Pure.';
REVOKE ALL ON FUNCTION public.axle_type_from_words(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.axle_type_from_words(text, boolean) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.axle_printed_words(p text)
RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  -- Printed words as shown in a source: contacts redacted, dollar amounts and comma-grouped sums removed, one line, 160 characters.
  -- Bare decimals stay (a gear ratio reads 3.73). A name written inside a free-text line cannot be stripped mechanically.
  SELECT left(btrim(regexp_replace(regexp_replace(public.text_redact_contact(p),
           '\$\s*[0-9][0-9,]*(\.[0-9]+)?|\m[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?\M', '[amount]', 'g'), '\s+', ' ', 'g')), 160)
$$;
REVOKE ALL ON FUNCTION public.axle_printed_words(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.axle_printed_words(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.vehicle_axle_type_evidence(p_vehicle_id uuid)
RETURNS TABLE(origin text, item_id uuid, image_id uuid, shop text, day date, axle_type text, printed text, method text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH v AS (
    SELECT v.id FROM public.vehicles v
     WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL
       AND (v.is_public IS TRUE OR auth.role() = 'service_role' OR (auth.uid() IS NOT NULL AND (v.user_id = auth.uid()
            OR v.owner_id = auth.uid() OR v.uploaded_by = auth.uid() OR public.vehicle_user_has_access(v.id, auth.uid()))))),
  -- (a) paper: the cheap words test first, then the placement and the line kind on the few lines that name a type.
  raw AS MATERIALIZED (
    SELECT i.id AS item_id, r.vendor_name, i.description, i.part_number, i.total_price, i.hours,
           i.line_date, l.page_date, r.receipt_date, nullif(btrim(i.performer), '') AS performer,
           public.axle_type_from_words(i.description) AS ty
      FROM v
      JOIN public.receipt_vehicle_links l ON l.vehicle_id = v.id AND l.status = 'linked' AND l.retired_at IS NULL
      JOIN public.receipts r ON r.id = l.receipt_id AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL
      JOIN public.receipt_items i ON i.receipt_id = r.id
     WHERE i.description ~* '(posi|limited|lsd|locker|spool|traction|trac.?lok|sure.?grip|safe.?t|true.?trac|open)'
       AND public.axle_type_from_words(i.description) IS NOT NULL),
  paper AS (
    SELECT w.item_id, w.ty,
           nullif(left(btrim(public.text_redact_contact(w.vendor_name)), 300), '') AS shop,
           public.axle_printed_words(w.description) AS printed,
           coalesce(CASE WHEN w.line_date <= current_date + 1 THEN w.line_date END,
                    CASE WHEN w.page_date <= current_date + 1 THEN w.page_date END,
                    CASE WHEN w.receipt_date <= current_date + 1 THEN w.receipt_date END) AS day
      FROM raw w
     WHERE public.receipt_line_system(w.description) = 'axle'
       AND (public.receipt_line_kind(w.description, w.part_number, w.total_price, w.hours, w.line_date, w.performer) IN ('labor', 'note')
            OR (public.receipt_line_kind(w.description, w.part_number, w.total_price, w.hours, w.line_date, w.performer) = 'part'
                AND w.part_number IS NULL AND lower(w.description) ~
                  '\y(check and repair|repair|rebuild|install(ation)?|replace|swap|convert(ed)?|labor|set ?up|service)\y'))),
  -- (b) photos: printed text on the picture, then component labels; never the reader's notes.
  ph AS MATERIALIZED (
    SELECT o.id AS obs_id, o.extraction_method, o.observed_at, w.printed,
           CASE WHEN w.src = 'text' THEN 0 ELSE 1 END AS rank, w.ty,
           CASE WHEN o.structured_data->>'image_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN (o.structured_data->>'image_id')::uuid END AS img
      FROM v
      JOIN public.vehicle_observations o ON o.vehicle_id = v.id AND o.extraction_method = 'reviewed_image_analysis_v1'
           AND o.is_superseded IS NOT TRUE AND o.superseded_by IS NULL
           -- One pass over the stored reading names the few that mention a unit at all; only those are unpacked.
           -- The same reading must also name the differential or axle, so a locker, a spool or a bottle of gear oil
           -- elsewhere in the picture is not an axle reading.
           AND jsonb_path_exists(o.structured_data, '$ ? (exists($.components_seen[*] ? (@.label like_regex "differential|\\bdiff\\b|axle|rear.?end|carrier" flag "i")) && (exists($.text_regions[*] ? (@.text like_regex "limited|posi|lsd|locker|spool|traction|trac.?lok|sure.?grip|safe.?t|true.?trac" flag "i")) || exists($.components_seen[*] ? (@.label like_regex "limited|posi|lsd|locker|spool|traction|trac.?lok|sure.?grip|safe.?t|true.?trac" flag "i"))))')
      CROSS JOIN LATERAL (
        SELECT 'text' AS src, x->>'text' AS printed, public.axle_type_from_words(x->>'text', false) AS ty
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.structured_data->'text_regions') = 'array' THEN o.structured_data->'text_regions' ELSE '[]'::jsonb END) x
        UNION ALL
        SELECT 'label', x->>'label', public.axle_type_from_words(x->>'label', false)
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.structured_data->'components_seen') = 'array' THEN o.structured_data->'components_seen' ELSE '[]'::jsonb END) x
         WHERE x->>'label' ~* 'differential|\ydiff\y|axle|rear.?end|carrier'
      ) w
     WHERE w.ty IS NOT NULL),
  one AS (
    SELECT DISTINCT ON (coalesce(p.img::text, p.obs_id::text), p.ty) p.*
      FROM ph p ORDER BY coalesce(p.img::text, p.obs_id::text), p.ty, p.rank, p.obs_id)
  SELECT 'paper', p.item_id, NULL::uuid, p.shop, p.day, p.ty, p.printed, 'receipt_items'
    FROM paper p
  UNION ALL
  -- The image is returned as an id only; whether the viewer may be shown it is decided in the invoker's reader.
  SELECT CASE WHEN o.rank = 0 THEN 'photo_text' ELSE 'photo_label' END, o.obs_id, o.img, NULL::text,
         o.observed_at::date, o.ty, public.axle_printed_words(o.printed), o.extraction_method
    FROM one o
$$;
COMMENT ON FUNCTION public.vehicle_axle_type_evidence(uuid) IS
  'Axle type evidence for the drivetrain panel: shop work lines placed in the axle system whose words name limited-slip, locking or open, and photo readings whose printed text or component labels name a limited-slip or locking unit. Day, shop, normalized type, printed words, witness ids. No amount, performer, contact, or reader notes. Same visibility as vehicle_build_reconstruction. Read-only.';
REVOKE ALL ON FUNCTION public.vehicle_axle_type_evidence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_axle_type_evidence(uuid) TO anon, authenticated, service_role;

DO $patch$
DECLARE
  d text;
  anchor text := E'\n),\n-- One row per (item, independent source';
  rec_old text := '(''drivetrain.axle.current.type'', v.rear_axle_type, ''text'', ''rear_axle_type'')';
  rec_new text := '(''drivetrain.axle.current.type'', v.rear_axle_type, ''axle_type'', ''rear_axle_type'')';
  branch text := $branch$
  UNION ALL
  -- facet_axle_type_v1: shop work lines in the axle system and photo readings of a limited-slip tag or unit
  -- (vehicle_axle_type_evidence). Paper is a claim, one source per shop. A photo is a reading, one source per image.
  SELECT 'drivetrain.axle.current.type', g.axle_type, 'axle_type', 'claim', 'shop:' || g.shop, 'src:axle_paper',
         g.last_day::timestamptz, 1,
         jsonb_build_object('slug', NULL, 'label', g.shop, 'kind', 'document', 'url', NULL,
           'method', 'vehicle_axle_type_evidence', 'observed_at', g.last_day::timestamptz,
           'witness', jsonb_build_object('kind', 'receipt_item', 'id', g.item_ids->>0, 'ids', g.item_ids),
           'value', g.n || CASE WHEN g.n = 1 THEN ' shop work line, ' ELSE ' shop work lines, ' END
                      || CASE WHEN g.first_day = g.last_day THEN g.first_day ELSE g.first_day || ' to ' || g.last_day END
                      || ', printed: "' || g.printed || '"',
           'class', 'claim',
           'limitation', 'the shop''s words on a repair line; they name the unit but nothing on the paper was checked against a tag or the carrier itself',
           'decoded', jsonb_strip_nulls(jsonb_build_object('type', g.axle_type, 'printed', g.printed, 'lines', g.n,
                                                           'first_day', g.first_day, 'last_day', g.last_day))),
         NULL::jsonb
  FROM (SELECT coalesce(a.shop, 'shop not named') AS shop, a.axle_type, count(*) AS n,
               min(a.day)::text AS first_day, max(a.day)::text AS last_day,
               (array_agg(a.printed ORDER BY a.day, a.item_id))[1] AS printed,
               jsonb_agg(a.item_id::text ORDER BY a.day, a.item_id) AS item_ids
        FROM axle_ev a
        WHERE a.origin = 'paper'
        GROUP BY 1, 2) g
  UNION ALL
  SELECT 'drivetrain.axle.current.type', a.axle_type, 'axle_type', 'reading',
         CASE WHEN a.image_id IS NOT NULL THEN 'img:' || a.image_id ELSE 'obs:' || a.item_id END, 'reader:' || a.method,
         coalesce(im.taken_at::date, a.day)::timestamptz, 1,
         jsonb_build_object('slug', NULL, 'label', 'photo reading', 'kind', 'image', 'url', NULL, 'method', a.method,
           'observed_at', coalesce(im.taken_at::date, a.day)::timestamptz,
           'witness', CASE WHEN im.id IS NOT NULL THEN jsonb_build_object('kind', 'image', 'id', im.id, 'thumb', im.thumb)
                           ELSE jsonb_build_object('kind', 'observation', 'id', a.item_id) END,
           'value', CASE a.origin WHEN 'photo_text' THEN 'text read in a photo of the differential: "' || a.printed || '"'
                                  ELSE 'a reader named the unit: "' || a.printed || '"' END,
           'class', 'reading',
           'limitation', CASE a.origin
             WHEN 'photo_text' THEN 'a tag on a cover bolt is replaceable and does not prove the carrier inside; the closed cover hides it'
             ELSE 'a reader''s label from outside; the closed cover hides the carrier' END,
           'decoded', jsonb_build_object('type', a.axle_type, 'printed', a.printed)),
         NULL::jsonb
  FROM axle_ev a
  -- The viewer's own image boundary (the invoker), as the other photo witnesses use it.
  LEFT JOIN LATERAL (
    SELECT i.id, i.taken_at, coalesce(i.thumbnail_url, i.medium_url, i.image_url) AS thumb
      FROM public.vehicle_images_public i
     WHERE i.id = a.image_id AND i.vehicle_id = a.vehicle_id AND public.vehicle_image_gallery_eligible(i) IS TRUE
       AND i.is_sensitive IS NOT TRUE AND i.is_document IS NOT TRUE AND i.is_duplicate IS NOT TRUE
       AND i.is_superseded IS NOT TRUE AND i.superseded_by IS NULL
     LIMIT 1) im ON true
  WHERE a.origin IN ('photo_text', 'photo_label')
  -- facet_axle_type_v1_end
$branch$;
  cte text := $cte$
-- facet_axle_type_v1: the axle type evidence, read once for the paper and photo branches below (drivetrain panel,
-- masthead and whole read only).
axle_ev AS MATERIALIZED (
  SELECT a.*, v.id AS vehicle_id FROM v CROSS JOIN LATERAL public.vehicle_axle_type_evidence(v.id) a
  WHERE p_dimension IS NULL OR p_dimension IN ('masthead', 'drivetrain')
),
$cte$;
  tanchor text := E'\n-- Every testimony row: item key';
  n integer;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  IF position('facet_axle_type_v1' IN d) = 0 THEN
    n := (length(d) - length(replace(d, tanchor, ''))) / length(tanchor);
    IF n <> 1 THEN RAISE EXCEPTION 'facet axle type CTE anchor drifted: % matches', n; END IF;
    d := replace(d, tanchor, cte || tanchor);
    n := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    IF n <> 1 THEN RAISE EXCEPTION 'facet axle type anchor drifted: % matches', n; END IF;
    n := (length(d) - length(replace(d, rec_old, ''))) / length(rec_old);
    IF n <> 1 THEN RAISE EXCEPTION 'facet axle type record row drifted: % matches', n; END IF;
    d := replace(d, rec_old, rec_new);
    d := replace(d, anchor, branch || anchor);
    EXECUTE d;
  END IF;

  d := pg_get_functiondef('public.vehicle_facet_norm(text,text)'::regprocedure);
  IF position('axle_type' IN d) = 0 THEN
    anchor := E'    WHEN p_kind = ''configuration'' THEN CASE';
    n := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    IF n <> 1 THEN RAISE EXCEPTION 'facet norm anchor drifted: % matches', n; END IF;
    d := replace(d, anchor, E'    WHEN p_kind = ''axle_type'' THEN coalesce(public.axle_type_from_words(s), s)\n' || anchor);
    EXECUTE d;
  END IF;
END $patch$;
