-- validate_import_url: match non-vehicle words as whole slug tokens, not substrings.
-- '%art%' rejected every URL containing the letters "art": Aston Martin, Dodge Dart, Abarth, smart
-- (2,552 BaT car lots in the catalog; 10 cars among the 18 settlement rows it skipped since 2026-09-27;
-- bat-data coverage audit, docs/ledger/2026-09-30_bat-data-coverage-audit.md, P4). '%sign%' also caught
-- "designo" and "signature", '%book%' caught any slug containing "book". Same words, now bounded by
-- slug separators (/ - _ . ? #) or the ends; "artwork" is listed so nothing the old filter caught as art slips.
-- Checked on prod before writing: smart-fortwo, aston-martin, dodge-dart, fiat-abarth, sl550-designo pass;
-- racing-art-print, neon-sign, manual-book are still rejected.
set lock_timeout = '5s';
set statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.validate_import_url(url text)
 RETURNS TABLE(valid boolean, reason text)
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Reject non-vehicle patterns
  IF url ILIKE '%/parts/%' OR url ILIKE '%/accessories/%' THEN
    RETURN QUERY SELECT FALSE, 'Parts/accessories URL';
    RETURN;
  END IF;

  IF url ~* '(^|[/_.?#-])(memorabilia|collectible|collectibles|book|books)([/_.?#-]|$)' THEN
    RETURN QUERY SELECT FALSE, 'Memorabilia/collectibles';
    RETURN;
  END IF;

  IF url ~* '(^|[/_.?#-])(art|artwork|poster|posters|sign|signs|telephone|telephones)([/_.?#-]|$)' THEN
    RETURN QUERY SELECT FALSE, 'Non-vehicle item';
    RETURN;
  END IF;

  -- Reject known blocked domains
  IF url ILIKE '%facebook.com%' THEN
    RETURN QUERY SELECT FALSE, 'Facebook requires auth';
    RETURN;
  END IF;

  IF url ILIKE '%ksl.com%' THEN
    RETURN QUERY SELECT FALSE, 'KSL blocks scrapers';
    RETURN;
  END IF;

  -- Reject Gooding (mostly memorabilia)
  IF url ILIKE '%goodingco.com%' AND url NOT LIKE '%/lot/19%' AND url NOT LIKE '%/lot/20%' THEN
    RETURN QUERY SELECT FALSE, 'Gooding non-vehicle lot';
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, NULL;
END;
$function$;
