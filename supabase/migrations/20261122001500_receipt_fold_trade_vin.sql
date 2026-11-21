-- receipt fold: a VIN the paper gives in a trade or payment role does not compete with the document's subject.
--
-- Why. receipt_vehicle_links_refresh(text, uuid) scans a receipt's transcription (raw_extraction, raw_json) for VINs and
-- makes a vin_exact candidate (0.97) for every vehicle on record with that VIN. A sale or build agreement prints two VINs:
-- the vehicle the paper is about, and the vehicle the customer hands over as payment ("Trade: white truck <VIN>"). When the
-- custodian is tied to both, the fold sees two strong vehicles and holds the paper as ambiguous_multiple_vehicles, so the
-- agreement never reaches its car. Measured 2026-11-21 (read-only): one prepared agreement (a build agreement whose payment
-- is a trade-in truck, both on record and tied to the custodian) would be held this way.
--
-- The rule. The role comes from the transcription's structure, never from free text: land_document_pages stores each line's
-- category (receipt_items.category; the lander sends it since #3679), and a line whose category names a trade or payment role
-- (receipt_line_consideration_role: "trade", "trade-in", "payment", "in exchange", "exchange", "consideration") marks the
-- VIN printed in its description as consideration. Such a VIN's vin_exact candidate steps out of the competition only when
--   * the VIN is in no untagged line of the same receipt, and
--   * it is not in the subject field (the transcription's vehicle_hint, i.e. the vehicle the paper names as its subject), and
--   * another vehicle stands as a strong candidate (vin_exact or cited_document) that is not itself tagged.
-- Otherwise nothing changes: when the roles cannot be told apart the receipt is held exactly as before. Only the vin_exact
-- candidate steps out; a trade vehicle that the document is also filed on (cited_document) still competes. The trade vehicle
-- gets no link (receipt_vehicle_links has no non-spend kind); the subject's link records it in basis_ref
-- ('consideration_vehicles': vehicle, vin, role category, rule).
--
-- Scope, measured 2026-11-21 (read-only): 0 receipt_items rows carry a role category today, so no existing receipt's link
-- changes; the rule acts when a receipt with such a line is next refreshed (receipt_link_one, land_document_pages).
--
-- Guard. receipt_vehicle_links_refresh(text, uuid) is fingerprinted (md5 of pg_get_functiondef, read 2026-11-21) and each
-- anchor must occur exactly once; a definition that already carries every replacement is left as it is (a rerun changes
-- nothing); anything else refuses before any change. Contract: supabase/sql/test_receipt_fold_trade_vin.sql.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

BEGIN;

CREATE TEMP TABLE trade_vin_patch (ord int PRIMARY KEY, anchor text NOT NULL, replacement text NOT NULL) ON COMMIT DROP;
INSERT INTO trade_vin_patch VALUES
 (10, $a$  drop table if exists _rb, _rcand, _rcg, _rc;$a$,
      $a$  drop table if exists _rb, _rcand, _rcg, _rc, _rcons;$a$),
 (20, $a$  create temp table _rcg on commit drop as$a$,
      $a$  -- A VIN the paper gives in a trade or payment role (a line whose category names that role) is consideration, not the
  -- document's subject: its vin_exact candidate steps out when the VIN is in no untagged line, is not the subject field, and
  -- another vehicle stands as a strong candidate that is not itself tagged. Otherwise nothing changes. (20261122001500)
  create temp table _rcons on commit drop as
  with tagged as (
    select c.rid, c.vid, c.ref->>'vin' vin, min(i.category) role_category
      from _rcand c join receipt_items i on i.receipt_id = c.rid
     where c.basis = 'vin_exact' and public.receipt_line_consideration_role(i.category)
       and upper(coalesce(i.description, '')) ~ ('(?<![A-Z0-9])' || (c.ref->>'vin') || '(?![A-Z0-9])')
       and not exists (select 1 from receipt_items j where j.receipt_id = c.rid and not public.receipt_line_consideration_role(j.category)
                         and upper(coalesce(j.description, '')) ~ ('(?<![A-Z0-9])' || (c.ref->>'vin') || '(?![A-Z0-9])'))
       and not exists (select 1 from _rb b where b.id = c.rid
                         and upper(concat_ws(' ', b.raw_json #>> '{data_v2,vehicle_hint}', b.raw_extraction #>> '{data,vehicle_hint}'))
                             ~ ('(?<![A-Z0-9])' || (c.ref->>'vin') || '(?![A-Z0-9])'))
     group by c.rid, c.vid, c.ref->>'vin')
  select t.* from tagged t
   where exists (select 1 from _rcand s where s.rid = t.rid and s.vid <> t.vid and s.basis in ('vin_exact', 'cited_document')
                   and not exists (select 1 from tagged u where u.rid = s.rid and u.vid = s.vid));
  delete from _rcand c using _rcons x where c.rid = x.rid and c.vid = x.vid and c.basis = 'vin_exact';

  create temp table _rcg on commit drop as$a$),
 (30, $a$    case when status='linked' then ref || jsonb_build_object('bases_agreeing',nbases) else coalesce(jsonb_build_object('candidates',cands),'{}') end,$a$,
      $a$    (case when status='linked' then ref || jsonb_build_object('bases_agreeing',nbases) else coalesce(jsonb_build_object('candidates',cands),'{}') end)
      || coalesce((select jsonb_build_object('consideration_vehicles', jsonb_agg(jsonb_build_object('vehicle', x.vid, 'vin', x.vin,
                     'role', x.role_category, 'rule', '20261122001500') order by x.vin))
                     from _rcons x where x.rid = _rc.rid having count(*) > 0), '{}'::jsonb),$a$);

CREATE OR REPLACE FUNCTION public.receipt_line_consideration_role(p_category text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  -- a line category that names a trade or payment role: the vehicle printed on that line is consideration, not the subject
  select coalesce(p_category ~* '^\s*(trade([- ]?in)?|payment|in exchange|exchange|consideration)\M', false)
$function$;
COMMENT ON FUNCTION public.receipt_line_consideration_role(text) IS
  'True for a receipt line category naming a trade or payment role (trade, trade-in, payment, in exchange, exchange, consideration). receipt_vehicle_links_refresh reads it so a VIN printed only on such a line does not compete with the document''s subject vehicle (20261122001500).';

DO $apply$
DECLARE d text; p record; k int; n_done int := 0;
BEGIN
  d := pg_get_functiondef('public.receipt_vehicle_links_refresh(text,uuid)'::regprocedure);
  SELECT count(*) INTO n_done FROM trade_vin_patch WHERE position(replacement in d) > 0;
  IF n_done = (SELECT count(*) FROM trade_vin_patch) THEN
    RAISE NOTICE 'receipt_vehicle_links_refresh already carries this migration; unchanged';
    RETURN;
  END IF;
  IF md5(d) <> 'da6c69ef750ec54ac8ebbc5168d3b56a' THEN -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
    RAISE EXCEPTION 'receipt_vehicle_links_refresh(text,uuid) changed since 2026-11-21 (md5 %); review before replacement', md5(d);
  END IF;
  FOR p IN SELECT * FROM trade_vin_patch ORDER BY ord LOOP
    k := (length(d) - length(replace(d, p.anchor, ''))) / length(p.anchor);
    IF k <> 1 THEN
      RAISE EXCEPTION 'receipt_vehicle_links_refresh: anchor % found % times, expected 1', p.ord, k;
    END IF;
    d := replace(d, p.anchor, p.replacement);
  END LOOP;
  EXECUTE d;
END
$apply$;

COMMIT;

RESET lock_timeout;
RESET statement_timeout;
