-- event_identity_status v2: stop false 'mismatch' verdicts from formatting, not identity.
-- Seen on 2026-10-24 (run event_identity_check_v1/v2): ~93% of Bonhams sold "mismatches" were the same car:
--  * Bonhams lot chassis captured from the URL slug ("-NO-<chassis>-ENGINE-NO-...", cut at 20 chars)
--  * vehicle VINs stored with O/I/Q dropped (WPOZZZ... vs WPZZZ...) or built from the same slug (N<chassis>ENGNEN)
-- vin_identity_norm strips the slug wrapper and maps O->0, I->1, Q->0; event_identity_status compares on it, adds a
-- truncated-slug prefix tier (lot slug length 20, >= 8 chars), and keeps the v1 equal / suffix (>=5) tiers.
create or replace function public.vin_identity_norm(p text)
 returns text language sql immutable parallel safe set search_path to '' as $f$
  with a as (select upper(coalesce(p,'')) s),
  b as (select regexp_replace(regexp_replace(s, '^-?NO-', ''), '(-E(N(G(I(N(E.*)?)?)?)?)?)?$|/ENGINE.*$|-DN/?$', '') s from a),
  c as (select regexp_replace(s, '[^A-Z0-9]', '', 'g') s from b),
  d as (select case when s ~ '^N[A-Z0-9]+ENGN' then regexp_replace(s, '^N([A-Z0-9]+?)ENGN.*$', '\1')
                    when s ~ '^N[0-9]' and length(s) <= 9 then substr(s, 2) else s end s from c)
  select nullif(ltrim(translate(s, 'OIQ', '010'), '0'), '') from d
$f$;

create or replace function public.event_identity_status(p_lot text, p_vin text)
 returns text language sql immutable parallel safe set search_path to '' as $function$
  with n as (select public.vin_identity_norm(p_lot) l, public.vin_identity_norm(p_vin) v,
                    regexp_replace(public.vin_identity_norm(p_lot), '[01]', '', 'g') l2,
                    regexp_replace(public.vin_identity_norm(p_vin), '[01]', '', 'g') v2,
                    p_lot ~ '^-NO-' and length(p_lot) = 20 truncated)
  select case
    when l is null or v is null or length(l) < 4 or length(v) < 4 then 'unknown'
    when l = v then 'match'
    -- partial chassis vs full VIN (e.g. lot "50049" vs VIN "...50049"): suffix of >=5 chars
    when length(l) >= 5 and length(v) >= 5 and (right(v, length(l)) = l or right(l, length(v)) = v) then 'match'
    -- VIN stored with O/I/Q removed instead of mapped (WPOZZZ -> WPZZZ)
    when length(l2) >= 5 and l2 = v2 then 'match'
    -- Bonhams URL slug cut at 20 chars: lot is a prefix of the VIN
    when truncated and length(l) >= 8 and left(v, length(l)) = l then 'match'
    else 'mismatch' end
  from n
$function$;
