-- vendor_organization_proposals: for each receipt vendor name with no organisation, the organisations the paper itself
-- points at, with the witnesses as keys, a state from a gate rule row, and promotion into the reviewed register only
-- through its own rows (supply_vendors / supply_vendor_aliases), whose triggers already set receipts.vendor_organization_id.
--
-- WHY. Measured 2026-11-25 (read-only):
--   * The 4 register vendors with decision gap_no_stable_identifier hold 33 receipts in all, 13 not duplicate or
--     superseded, 7 live linked to a car. Their 7 receipts render "Seller not identified". 0 organisations match any of
--     them by name, printed phone or printed domain.
--   * Over every receipt with no vendor organisation (1,751 receipts, 1,094 vendor keys): 84 key x organisation pairs by
--     exact name, phone printed on the paper (raw_extraction.data.merchant_phone, last 10 digits) or a domain in the
--     reading. 16 keys point at exactly one organisation; 1 of them has two witnesses, and it covers no live linked
--     receipt.
--   Nothing recorded those findings, so no new organisation (or new alias) reached the old receipts.
--
-- WHAT.
--   vendor_organization_proposal_rules (rule rows): three witness kinds (exact_name, printed_phone, printed_domain) and
--     the promotion gate (params: min_witness_kinds 2, unique_candidate, public_organization, min_supply_kinds 1).
--   vendor_organization_proposals (grain: one vendor key x one candidate organisation, or the key alone when there is
--     none): vendor_key, vendor_slug (FK supply_vendors, when the key is a reviewed alias), organization_id FK,
--     witness_kinds, candidates, receipts, linked_receipts, proposed_supply_kinds, state, run_id, created_at,
--     retired_at. Subjects: vendor keys with a live linked receipt that has no organisation, plus every alias of a gap
--     vendor. A row is retired and replaced when its witnesses, candidates, kinds or state change.
--   States, first match: no_organisation_in_register, held_ambiguous (more than one candidate),
--     held_unpublished_organization (is_public false: not published; often create_organization_batch's staging default,
--     not a privacy choice, so a later publication or label rule can release it),
--     held_one_witness, held_no_supply_kind, ready, then promoted.
--   proposed_supply_kinds: a reviewed vendor keeps its reviewed kinds; any other key takes up to 6 kinds from its own
--     receipt lines through receipt_line_edges.system_key -> supply_category_kinds (existing rule rows). With no
--     mapped line, the row is held_no_supply_kind, and the reason is that state.
--   vendor_organization_proposals_fold(p_run): the only writer of proposals. A ready row is promoted: a gap vendor's
--     register row becomes existing_organization with that organisation; any other key gets a register row and an alias.
--     The register's triggers carry the organisation to the receipts. It mints no organisation.
-- Cron vendor-organization-proposals daily 04:53 UTC. Gauge: SELECT state, count(*) FROM vendor_organization_proposals
-- WHERE retired_at IS NULL GROUP BY 1.
-- PREDICTED on apply: ready 0, promoted 0. The 4 gap vendors land as no_organisation_in_register.
-- Contract: supabase/sql/test_vendor_organization_proposals.sql (PG17).
-- Revert: supabase/sql/revert_20261125021500_vendor_organization_proposals.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.vendor_organization_proposal_rules (
  rule_key text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('witness', 'gate')),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text NOT NULL
);
INSERT INTO public.vendor_organization_proposal_rules (rule_key, kind, params, description) VALUES
  ('exact_name', 'witness', '{}', 'the receipt vendor key equals supply_vendor_key of the organisation''s business name or name'),
  ('printed_phone', 'witness', '{}', 'the last 10 digits of the phone printed on the paper (raw_extraction.data.merchant_phone) equal the organisation''s phone'),
  ('printed_domain', 'witness', '{}', 'a domain in the paper''s reading, not part of an email address, equals the organisation''s website domain'),
  ('promote', 'gate', '{"min_witness_kinds": 2, "unique_candidate": true, "public_organization": true, "min_supply_kinds": 1}',
   'promote a proposal into the register only with one candidate, at least two witness kinds, a public organisation and a supply kind')
ON CONFLICT (rule_key) DO UPDATE SET kind = EXCLUDED.kind, params = EXCLUDED.params, description = EXCLUDED.description;
ALTER TABLE public.vendor_organization_proposal_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_organization_proposal_rules_read ON public.vendor_organization_proposal_rules;
CREATE POLICY vendor_organization_proposal_rules_read ON public.vendor_organization_proposal_rules FOR SELECT USING (true);
REVOKE ALL ON public.vendor_organization_proposal_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vendor_organization_proposal_rules TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.vendor_organization_proposals (
  id bigserial PRIMARY KEY,
  vendor_key text NOT NULL,
  vendor_slug text REFERENCES public.supply_vendors(vendor_slug) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  witness_kinds text[] NOT NULL DEFAULT '{}',
  candidates int NOT NULL,
  receipts int NOT NULL,
  linked_receipts int NOT NULL,
  proposed_supply_kinds text[],
  state text NOT NULL CHECK (state IN ('no_organisation_in_register', 'held_ambiguous', 'held_unpublished_organization',
                                       'held_one_witness', 'held_no_supply_kind', 'ready', 'promoted')),
  run_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  CHECK ((state = 'no_organisation_in_register') = (organization_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS vendor_organization_proposals_live_key
  ON public.vendor_organization_proposals (vendor_key, coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE retired_at IS NULL;
ALTER TABLE public.vendor_organization_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vendor_organization_proposals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vendor_organization_proposals TO service_role;
COMMENT ON TABLE public.vendor_organization_proposals IS
  'vendor_organization_proposals_v1: receipt vendor key -> candidate organisation, witnesses by rule row, state by the promote gate. Written only by vendor_organization_proposals_fold; retired, never deleted. Service only.';

CREATE OR REPLACE FUNCTION public.vendor_organization_proposals_due()
RETURNS TABLE (vendor_key text, vendor_slug text, organization_id uuid, witness_kinds text[], candidates int, receipts int,
               linked_receipts int, proposed_supply_kinds text[], state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $due$
  WITH rc_all AS (
    SELECT r.id, public.supply_vendor_key(r.vendor_name) AS vk, r.raw_extraction,
           EXISTS (SELECT 1 FROM public.receipt_vehicle_links l WHERE l.receipt_id = r.id AND l.status = 'linked' AND l.retired_at IS NULL) AS linked
      FROM public.receipts r
     WHERE r.vendor_organization_id IS NULL AND r.duplicate_of IS NULL AND coalesce(r.is_superseded, false) = false
       AND length(coalesce(public.supply_vendor_key(r.vendor_name), '')) >= 3
  ),
  gap AS (
    SELECT a.alias_key AS vk, v.vendor_slug, v.supply_kinds
      FROM public.supply_vendor_aliases a JOIN public.supply_vendors v ON v.vendor_slug = a.vendor_slug
     WHERE v.decision = 'gap_no_stable_identifier'
  ),
  subjects AS (
    SELECT DISTINCT rc.vk FROM rc_all rc WHERE rc.linked
    UNION SELECT g.vk FROM gap g
  ),
  rc AS (
    SELECT rc.*,
           right(regexp_replace(coalesce(rc.raw_extraction #>> '{data,merchant_phone}', rc.raw_extraction ->> 'merchant_phone', ''), '[^0-9]', '', 'g'), 10) AS ph
      FROM rc_all rc WHERE rc.vk IN (SELECT vk FROM subjects)
  ),
  rc_dom AS (
    SELECT DISTINCT rc.vk, m[1] AS dom
      FROM rc CROSS JOIN LATERAL regexp_matches(lower(coalesce(rc.raw_extraction::text, '')),
             '(?<![@a-z0-9.-])(?:www\.)?([a-z0-9-]+\.(?:com|net|org|us|biz|co))\M', 'g') AS m
  ),
  org AS (
    SELECT o.id, public.supply_vendor_key(coalesce(nullif(btrim(o.business_name), ''), o.name)) AS nk,
           public.supply_vendor_key(o.name) AS nk2,
           right(regexp_replace(coalesce(o.phone, ''), '[^0-9]', '', 'g'), 10) AS ph,
           lower(substring(coalesce(o.website, '') FROM '^(?:https?://)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)')) AS dom,
           coalesce(o.is_public, false) AS is_public
      FROM public.organizations o
     WHERE coalesce(o.status, 'active') = 'active' AND coalesce(o.is_active, true)
  ),
  w AS (
    SELECT DISTINCT rc.vk, org.id AS org_id, 'exact_name'::text AS kind FROM (SELECT DISTINCT vk FROM rc) rc JOIN org ON rc.vk IN (org.nk, org.nk2)
    UNION SELECT DISTINCT rc.vk, org.id, 'printed_phone' FROM rc JOIN org ON length(rc.ph) = 10 AND org.ph = rc.ph
    UNION SELECT DISTINCT d.vk, org.id, 'printed_domain' FROM rc_dom d JOIN org ON org.dom = d.dom
  ),
  pairs AS (
    SELECT w.vk, w.org_id, array_agg(DISTINCT w.kind ORDER BY w.kind) AS kinds
      FROM w JOIN public.vendor_organization_proposal_rules ru ON ru.rule_key = w.kind AND ru.kind = 'witness'
     GROUP BY 1, 2
  ),
  counts AS (
    SELECT s.vk, (SELECT count(*) FROM pairs p WHERE p.vk = s.vk)::int AS cands,
           (SELECT count(*) FROM rc WHERE rc.vk = s.vk)::int AS n, (SELECT count(*) FROM rc WHERE rc.vk = s.vk AND rc.linked)::int AS n_linked
      FROM subjects s
  ),
  kinds AS (
    SELECT x.vk, (array_agg(x.supply_kind ORDER BY x.lines DESC, x.supply_kind))[1:6] AS kinds
      FROM (SELECT rc.vk, c.supply_kind, count(*) AS lines
              FROM rc JOIN public.receipt_items i ON i.receipt_id = rc.id
              JOIN public.receipt_line_edges e ON e.receipt_item_id = i.id
              JOIN public.supply_category_kinds c ON c.category = e.system_key
             GROUP BY 1, 2) x
     GROUP BY 1
  ),
  gate AS (
    SELECT coalesce((params ->> 'min_witness_kinds')::int, 2) AS min_w, coalesce((params ->> 'min_supply_kinds')::int, 1) AS min_k,
           coalesce((params ->> 'unique_candidate')::boolean, true) AS uniq, coalesce((params ->> 'public_organization')::boolean, true) AS pub
      FROM public.vendor_organization_proposal_rules WHERE rule_key = 'promote'
  ),
  rows_ AS (
    SELECT c.vk, g.vendor_slug, p.org_id, coalesce(p.kinds, '{}') AS kinds, c.cands, c.n, c.n_linked,
           coalesce(g.supply_kinds, k.kinds) AS sk, o.is_public
      FROM counts c
      LEFT JOIN pairs p ON p.vk = c.vk
      LEFT JOIN org o ON o.id = p.org_id
      LEFT JOIN (SELECT DISTINCT ON (vk) vk, vendor_slug, supply_kinds FROM gap ORDER BY vk, vendor_slug) g ON g.vk = c.vk
      LEFT JOIN kinds k ON k.vk = c.vk
  )
  SELECT r.vk, r.vendor_slug, r.org_id, r.kinds, r.cands, r.n, r.n_linked, r.sk,
         CASE WHEN r.org_id IS NULL THEN 'no_organisation_in_register'
              WHEN gate.uniq AND r.cands > 1 THEN 'held_ambiguous'
              WHEN gate.pub AND NOT r.is_public THEN 'held_unpublished_organization'
              WHEN cardinality(r.kinds) < gate.min_w THEN 'held_one_witness'
              WHEN coalesce(cardinality(r.sk), 0) < gate.min_k THEN 'held_no_supply_kind'
              ELSE 'ready' END
    FROM rows_ r CROSS JOIN gate
$due$;
REVOKE ALL ON FUNCTION public.vendor_organization_proposals_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vendor_organization_proposals_due() TO service_role;

CREATE OR REPLACE FUNCTION public.vendor_organization_proposals_fold(p_run text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fold$
DECLARE
  v_run text := coalesce(p_run, 'vendor-organization-proposals:' || to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'));
  v_retired int; v_added int; v_promoted int := 0; p record; v_slug text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('vendor_organization_proposals_fold')) THEN
    RETURN jsonb_build_object('run', v_run, 'skipped', 'another fold holds the lock');
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS _vop_due (vendor_key text, vendor_slug text, organization_id uuid, witness_kinds text[], candidates int,
    receipts int, linked_receipts int, proposed_supply_kinds text[], state text) ON COMMIT DROP;
  TRUNCATE _vop_due;
  INSERT INTO _vop_due SELECT * FROM public.vendor_organization_proposals_due();

  -- a live row stays while its content is unchanged; a promoted row stays while its organisation is still the key's
  UPDATE public.vendor_organization_proposals x SET retired_at = now()
   WHERE x.retired_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM _vop_due d
                      WHERE d.vendor_key = x.vendor_key AND d.organization_id IS NOT DISTINCT FROM x.organization_id
                        AND d.vendor_slug IS NOT DISTINCT FROM x.vendor_slug AND d.witness_kinds = x.witness_kinds
                        AND d.candidates = x.candidates AND d.proposed_supply_kinds IS NOT DISTINCT FROM x.proposed_supply_kinds
                        AND (d.state = x.state OR (x.state = 'promoted' AND d.state = 'ready')))
     AND NOT (x.state = 'promoted' AND EXISTS (SELECT 1 FROM public.supply_vendor_aliases a JOIN public.supply_vendors v ON v.vendor_slug = a.vendor_slug
                                                WHERE a.alias_key = x.vendor_key AND v.organization_id = x.organization_id));
  GET DIAGNOSTICS v_retired = ROW_COUNT;

  INSERT INTO public.vendor_organization_proposals (vendor_key, vendor_slug, organization_id, witness_kinds, candidates, receipts,
         linked_receipts, proposed_supply_kinds, state, run_id)
  SELECT d.vendor_key, d.vendor_slug, d.organization_id, d.witness_kinds, d.candidates, d.receipts, d.linked_receipts,
         d.proposed_supply_kinds, d.state, v_run
    FROM _vop_due d
   WHERE NOT EXISTS (SELECT 1 FROM public.vendor_organization_proposals x
                      WHERE x.retired_at IS NULL AND x.vendor_key = d.vendor_key
                        AND coalesce(x.organization_id, '00000000-0000-0000-0000-000000000000'::uuid)
                          = coalesce(d.organization_id, '00000000-0000-0000-0000-000000000000'::uuid));
  GET DIAGNOSTICS v_added = ROW_COUNT;

  -- promotion through the register only; its triggers carry the organisation to the receipts
  FOR p IN SELECT x.* FROM public.vendor_organization_proposals x WHERE x.retired_at IS NULL AND x.state = 'ready' ORDER BY x.id LOOP
    IF p.vendor_slug IS NOT NULL THEN
      UPDATE public.supply_vendors v
         SET decision = 'existing_organization', organization_id = p.organization_id,
             basis = v.basis || '; organisation from vendor_organization_proposals ' || p.id || ' (' || array_to_string(p.witness_kinds, '+') || ')'
       WHERE v.vendor_slug = p.vendor_slug AND v.decision = 'gap_no_stable_identifier';
    ELSE
      v_slug := 'vop_' || btrim(regexp_replace(p.vendor_key, '[^a-z0-9]+', '_', 'g'), '_');
      INSERT INTO public.supply_vendors (vendor_slug, business_name, decision, organization_id, domain, supply_kinds, basis, reviewed_at)
      SELECT v_slug, coalesce(nullif(btrim(o.business_name), ''), o.name), 'existing_organization', o.id, NULL, p.proposed_supply_kinds,
             'vendor_organization_proposals ' || p.id || ' (' || array_to_string(p.witness_kinds, '+') || '); ' || p.receipts || ' receipts',
             current_date
        FROM public.organizations o WHERE o.id = p.organization_id
      ON CONFLICT (vendor_slug) DO NOTHING;
      INSERT INTO public.supply_vendor_aliases (alias_key, vendor_slug)
      SELECT p.vendor_key, v_slug WHERE EXISTS (SELECT 1 FROM public.supply_vendors v WHERE v.vendor_slug = v_slug AND v.organization_id = p.organization_id)
      ON CONFLICT (alias_key) DO NOTHING;
    END IF;
    IF EXISTS (SELECT 1 FROM public.supply_vendor_aliases a JOIN public.supply_vendors v ON v.vendor_slug = a.vendor_slug
                WHERE a.alias_key = p.vendor_key AND v.organization_id = p.organization_id) THEN
      UPDATE public.vendor_organization_proposals SET state = 'promoted' WHERE id = p.id;
      v_promoted := v_promoted + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('run', v_run, 'added', v_added, 'retired', v_retired, 'promoted', v_promoted,
    'live', (SELECT jsonb_object_agg(state, n) FROM (SELECT state, count(*) n FROM public.vendor_organization_proposals
                                                     WHERE retired_at IS NULL GROUP BY 1) s));
END
$fold$;
REVOKE ALL ON FUNCTION public.vendor_organization_proposals_fold(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vendor_organization_proposals_fold(text) TO service_role;

DO $$ BEGIN RAISE NOTICE 'vendor_organization_proposals first run: %',
  public.vendor_organization_proposals_fold('vendor-organization-proposals:migration-20261125021500'); END $$;

DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'vendor-organization-proposals';
    PERFORM cron.schedule('vendor-organization-proposals', '53 4 * * *',
      $c$SET statement_timeout = '110s'; SET lock_timeout = '5s'; SELECT public.vendor_organization_proposals_fold(NULL)$c$);
  END IF;
END $$;

COMMIT;
