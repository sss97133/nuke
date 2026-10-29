-- VIN quality layer (additive, read-only; stored vehicles.vin is never modified).
-- Standards:
--  * 49 CFR Part 565 (NHTSA VIN requirements), applicable from model year 1981: 17 characters,
--    letters I, O and Q are not permitted (565.15), position 9 is a check digit computed with the
--    transliteration and weight table of 565.15(c) (mod 11, remainder 10 = 'X'). The check digit is
--    required for vehicles for sale in North America; ISO 3779 VINs from other regions may lack it,
--    so a mismatch is reported (check_digit_valid=false), not treated as proof of a bad VIN.
--  * Before MY1981 there was no common standard: manufacturers used free-form chassis/serial
--    numbers. These are classed pre1981_chassis and only checked for transcription artifacts.
-- Classes (vin_format_class):
--   missing                  null/blank
--   placeholder              N/A, UNKNOWN, TBD, all one repeated character, etc.
--   valid_17                 17 chars, legal charset, check digit valid
--   check_digit_mismatch     17 chars, legal charset, position 9 does not match (non-NA VIN or typo)
--   illegal_chars_17         17 chars containing I, O, Q or non-alphanumerics after normalisation
--   wrong_length_post1980    model year >= 1981 but normalised length <> 17
--   pre1981_chassis          model year < 1981 (or unknown year and length <> 17), free-form
--   stray_affix              a short (< 17) number with a stray leading or trailing 'I' (OCR/transcription
--                            artifact, e.g. '1445265I', 'IA045522'); vin_normalized strips it
-- vin_normalized: upper case, spaces/dashes/dots/slashes removed, stray 'I' affix stripped; null for missing/placeholder.
-- Revert: drop view public.vehicle_vin_quality; drop function public.vin_format_check(text, integer);
create or replace function public.vin_format_check(p_vin text, p_year integer,
  out vin_normalized text, out vin_format_class text, out check_digit_valid boolean)
language plpgsql immutable parallel safe set search_path to '' as $$
declare s text; core text; tr int[] := '{1,2,3,4,5,6,7,8,0,1,2,3,4,5,0,7,0,9,2,3,4,5,6,7,8,9}'; -- A..Z per 49 CFR 565.15(c); I,O,Q = 0 (illegal)
        w int[] := '{8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2}'; tot int := 0; ch text; i int; r int;
begin
  check_digit_valid := null;
  s := upper(btrim(coalesce(p_vin, '')));
  if s = '' then vin_format_class := 'missing'; return; end if;
  s := regexp_replace(s, '[\s\-\./]', '', 'g');
  if s = '' or s ~ '^(N/?A|NA|NONE|UNKNOWN|UNK|TBD|TBA|NOVIN|NOTAVAILABLE|VIN|SEEDESCRIPTION)$' or s ~ '^(.)\1*$' then
    vin_format_class := 'placeholder'; return; end if;
  if length(s) <> 17 and (s ~ '^[0-9][0-9A-Z]{3,15}[0-9]I$' or s ~ '^I[A-Z]?[0-9]{4,15}[A-Z0-9]?$' ) then
    core := case when s ~ 'I$' and s !~ '^I' then left(s, -1) when s ~ '^I' and s !~ 'I$' then substr(s, 2) else s end;
    if core <> s then vin_normalized := core; vin_format_class := 'stray_affix'; return; end if;
  end if;
  vin_normalized := s;
  if length(s) = 17 then
    if s !~ '^[A-HJ-NPR-Z0-9]{17}$' then vin_format_class := 'illegal_chars_17'; return; end if;
    for i in 1..17 loop
      ch := substr(s, i, 1);
      tot := tot + (case when ch ~ '[0-9]' then ch::int else tr[ascii(ch) - 64] end) * w[i];
    end loop;
    r := tot % 11;
    check_digit_valid := substr(s, 9, 1) = case when r = 10 then 'X' else r::text end;
    vin_format_class := case when check_digit_valid then 'valid_17' else 'check_digit_mismatch' end;
    return;
  end if;
  vin_format_class := case when p_year >= 1981 then 'wrong_length_post1980' else 'pre1981_chassis' end;
end $$;
comment on function public.vin_format_check(text, integer) is
  'VIN quality per 49 CFR 565 (MY1981+: 17 chars, no I/O/Q, position-9 check digit for North America); pre-1981 chassis numbers free-form with stray I affix detection. Read-only; never rewrites stored VINs.';
create or replace view public.vehicle_vin_quality with (security_invoker = true) as
  select v.id as vehicle_id, v.vin as vin_stored, v.year, q.vin_normalized, q.vin_format_class, q.check_digit_valid
    from public.vehicles v cross join lateral public.vin_format_check(v.vin, v.year) q;
comment on view public.vehicle_vin_quality is 'Per-vehicle VIN quality (vin_format_check). vin_stored is untouched.';
