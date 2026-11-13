-- vehicle_profile_read: a strip gap carries its token's lead item.
--
-- WHY. The strip lists a dimension as a gap when the vehicle record holds no value for it, even when the token's own
-- items hold one (proof vehicle: drivetrain.current.layout 'RWD' as a photo reading, while the header printed
-- "Drivetrain —"). The header is the banner for what the items establish; it showed less than they hold.
--
-- WHAT. Anchor patch of the deployed body (marker strip_gap_lead_v1): each gap object gains `lead`, the first item of
-- that token with a value and a status other than missing, current facet first, in the reader's item order:
-- {key, value, status}. A gap with no such item is unchanged (no `lead` key). The gap stays a gap: the record still
-- holds nothing, and the renderer shows the lead with its status.
BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';

DO $migration$
DECLARE
  d text := pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure);
  anchor text := $a$jsonb_build_object('dimension', g.dim, 'label', g.label)$a$;
  n integer;
BEGIN
  IF position('strip_gap_lead_v1' in d) = 0 THEN
    n := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    IF n <> 1 THEN RAISE EXCEPTION 'vehicle_profile_read strip gap anchor drifted (found % times)', n; END IF;
    d := replace(d, anchor,
      $a$(jsonb_build_object('dimension', g.dim, 'label', g.label) /* strip_gap_lead_v1 */
             || coalesce((SELECT jsonb_build_object('lead', jsonb_build_object('key', x->>'key', 'value', x->>'value', 'status', x->>'status'))
                          FROM jsonb_array_elements(CASE WHEN jsonb_typeof((SELECT doc FROM token_items)->g.dim) = 'array'
                                                         THEN (SELECT doc FROM token_items)->g.dim ELSE '[]'::jsonb END)
                               WITH ORDINALITY e(x, o)
                          WHERE x->>'status' IN ('established', 'reading', 'claim', 'conflict')
                            AND nullif(btrim(x->>'value'), '') IS NOT NULL
                          ORDER BY (x->>'facet' = 'current') DESC, o
                          LIMIT 1), '{}'::jsonb))$a$);
    EXECUTE d;
  END IF;
END
$migration$;

COMMIT;
