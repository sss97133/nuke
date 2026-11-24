-- Revert 20261124022000_spec_readings_review: restore the 20261124020000 / 20261124021000 bodies.
-- Note: the before/after snapshots taken under one snapshot id would collide with the old key; delete the later phase first.
begin;
set local lock_timeout = '5s';
ALTER TABLE public.field_coverage_snapshots DROP CONSTRAINT IF EXISTS field_coverage_snapshots_snapshot_phase_cohort_field_key;
ALTER TABLE public.field_coverage_snapshots
  ADD CONSTRAINT field_coverage_snapshots_snapshot_id_cohort_field_key UNIQUE (snapshot_id, cohort, field);

CREATE OR REPLACE FUNCTION public.text_spec_matches_v2(p_text text, p_src text, p_make text, p_model text)
RETURNS TABLE(kind text, code text, match_text text, match_offset integer, pattern_key text, base_conf numeric)
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH p(kind, pattern_key, re, flags, grp, grp2, fixed, base_conf, srcs, makes, model_re) AS (VALUES
    -- body style: title and the description's opening only
    ('body_style','body_convertible','\m(convertible|cabriolet|drop-?top|rag-?top)\M','i',1,0,'CONVERTIBLE',0.60,'{title,lead}'::text[],NULL::text[],NULL::text),
    ('body_style','body_fastback','\m(fastback|sportsroof|sports roof)\M','i',1,0,'FASTBACK',0.60,'{title,lead}',NULL,NULL),
    ('body_style','body_hardtop','\m(hardtop|hard-top)\M','i',1,0,'HARDTOP',0.55,'{title,lead}',NULL,NULL),
    ('body_style','body_coupe','\m(coupe|coupé)\M','i',1,0,'COUPE',0.60,'{title,lead}',NULL,NULL),
    ('body_style','body_hatchback','\m(hatchback|liftback)\M','i',1,0,'HATCHBACK',0.55,'{title,lead}',NULL,NULL),
    ('body_style','body_sedan','\m(sedan|saloon)\M','i',1,0,'SEDAN',0.55,'{title,lead}',NULL,NULL),
    ('body_style','body_wagon','\m(station wagon|wagon|shooting brake)\M','i',1,0,'WAGON',0.55,'{title,lead}',NULL,NULL),
    ('body_style','body_roadster','\m(roadster|spyder)\M','i',1,0,'ROADSTER',0.55,'{title,lead}',NULL,NULL),
    ('body_style','body_targa','\m(targa)\M','i',1,0,'TARGA',0.55,'{title,lead}',NULL,NULL),
    -- trim level: model-family dictionaries, title and the description's opening only
    ('trim_level','trim_trans_am','\m(trans[- ]?am)\M','i',1,0,'TRANS_AM',0.65,'{title,lead}','{pontiac}','firebird|trans ?am'),
    ('trim_level','trim_formula','\m(formula)\M','i',1,0,'FORMULA',0.60,'{title,lead}','{pontiac}','firebird|trans ?am|formula'),
    ('trim_level','trim_esprit','\m(esprit)\M','i',1,0,'ESPRIT',0.60,'{title,lead}','{pontiac}','firebird|esprit'),
    ('trim_level','trim_mach_1','\m(mach[- ]?(?:1|i|one))\M','i',1,0,'MACH_1',0.65,'{title,lead}','{ford}','mustang|mach'),
    ('trim_level','trim_boss','\m(boss[- ]?(302|351|429))\M','i',2,0,NULL,0.65,'{title,lead}','{ford}','mustang|boss'),
    ('trim_level','trim_gt500kr','\m(gt[- ]?500[- ]?kr)\M','i',1,0,'SHELBY_GT500KR',0.65,'{title,lead}','{ford,shelby}',NULL),
    ('trim_level','trim_gt500','\m(gt[- ]?500)\M','i',1,0,'SHELBY_GT500',0.60,'{title,lead}','{ford,shelby}',NULL),
    ('trim_level','trim_gt350','\m(gt[- ]?350)\M','i',1,0,'SHELBY_GT350',0.60,'{title,lead}','{ford,shelby}',NULL),
    ('trim_level','trim_mustang_gt','\m(GT)\M','',1,0,'GT',0.55,'{title,lead}','{ford}','mustang'),
    ('trim_level','trim_grande','\m(grand[eé])\M','i',1,0,'GRANDE',0.60,'{title,lead}','{ford}','mustang|grande'),
    ('trim_level','trim_cal_special','\m(california special|gt/cs)\M','i',1,0,'CALIFORNIA_SPECIAL',0.60,'{title,lead}','{ford}','mustang'),
    ('trim_level','trim_hcs','\m(high country special)\M','i',1,0,'HIGH_COUNTRY_SPECIAL',0.60,'{title,lead}','{ford}','mustang'),
    ('trim_level','trim_z28','\m(z[/-]?28)\M','i',1,0,'Z28',0.65,'{title,lead}','{chevrolet}','camaro|z ?/?28'),
    ('trim_level','trim_ss','\m(SS)\M','',1,0,'SS',0.60,'{title,lead}','{chevrolet}','camaro'),
    ('trim_level','trim_rs','\m(RS|rally sport)\M','',1,0,'RS',0.60,'{title,lead}','{chevrolet}','camaro'),
    ('trim_level','trim_rally_sport','\m(rally sport)\M','i',1,0,'RS',0.60,'{title,lead}','{chevrolet}','camaro'),
    ('trim_level','trim_pace_car','\m(pace car)\M','i',1,0,'PACE_CAR',0.55,'{title,lead}','{chevrolet}','camaro'),
    ('trim_level','trim_copo','\m(COPO)\M','i',1,0,'COPO',0.60,'{title,lead}','{chevrolet}','camaro'),
    ('trim_level','trim_yenko','\m(yenko)\M','i',1,0,'YENKO',0.60,'{title,lead}','{chevrolet}','camaro|yenko'),
    -- engine displacement (cubic inches as stated)
    ('engine_cid','cid_unit','\m([1-9][0-9]{2})\s*-?\s*(?:ci|cid|c\.i\.d?\.?|cu\.?\s?in\.?|cubic[- ]inch(?:es)?|cubic[- ]in\.?|cubic)(?![a-z])','i',1,0,NULL,0.60,'{title,listing}',NULL,NULL),
    ('engine_cid','cid_v8','\m([2-5][0-9]{2})\s*-?\s*V-?8\M','i',1,0,NULL,0.55,'{title,listing}',NULL,NULL),
    ('engine_cid','cid_ho_sd','\m([34][0-9]{2})\s*-?\s*(?:H\.?O\.?|SD|super duty|ram air)\M','i',1,0,NULL,0.55,'{title,listing}','{pontiac}',NULL),
    ('engine_cid','cid_sd_prefix','\m(?:SD|HO|ram air)\s*-?\s*([34][0-9]{2})\M','i',1,0,NULL,0.55,'{title,listing}','{pontiac}',NULL),
    ('engine_cid','cid_powered','\m([2-5][0-9]{2})[- ](?:powered|equipped|swapped)\M','i',1,0,NULL,0.60,'{title}',NULL,NULL),
    -- Ford engine letter as stated (R-code, K-code ...)
    ('engine_code','ford_letter_code','\m([ACFHKMRSJQTUZ])[- ]?[Cc]ode\M','',1,0,NULL,0.55,'{title,listing,comment}','{ford,mercury,shelby}',NULL),
    -- transmission speeds and type
    ('trans_speeds','speeds_n','\m(three|four|five|six|3|4|5|6)[- ]?(?:speed|spd)\M','i',1,0,NULL,0.60,'{title,listing}',NULL,NULL),
    ('trans_speeds','speeds_on_floor','\m(four|three)[- ]on[- ]the[- ](?:floor|tree)\M','i',1,0,NULL,0.55,'{title,listing}',NULL,NULL),
    ('trans_type','type_after_speeds','\m(?:three|four|five|six|3|4|5|6)[- ]?(?:speed|spd)\s+(manual|automatic|auto|stick)\M','i',1,0,NULL,0.60,'{title,listing}',NULL,NULL),
    ('trans_type','type_label','\m(manual|automatic|auto)\s+(?:transmission|gearbox|trans(?:axle)?|tranny)\M','i',1,0,NULL,0.60,'{title,listing}',NULL,NULL),
    ('trans_type','type_stick','\m(stick[- ]?shift|(?:four|three)[- ]on[- ]the[- ](?:floor|tree))\M','i',1,0,'MANUAL',0.55,'{title,listing}',NULL,NULL),
    ('trans_type','type_auto_model','\m(turbo[- ]?hydra-?matic|hydra-?matic|power-?glide|cruise-?o-?matic|torqueflite|select-?shift|th-?[234]00|turbo[- ]?(?:350|400)|700-?r-?4|200-?4r|4l[68]0-?e?|fmx)\M','i',1,0,'AUTOMATIC',0.55,'{title,listing}',NULL,NULL),
    ('trans_type','type_manual_model','\m(muncie|borg[- ]warner\s+(?:super\s+)?t-?10|super\s+t-?10|top[- ]?loader|tremec|doug nash)\M','i',1,0,'MANUAL',0.55,'{title,listing}',NULL,NULL),
    -- transmission model
    ('trans_model','gm_m2x','\m(M-?2[012])\M','i',1,0,NULL,0.60,'{title,listing,comment}','{chevrolet,pontiac,buick,oldsmobile,gmc}',NULL),
    ('trans_model','rock_crusher','\m(rock[- ]?crusher)\M','i',1,0,'M22',0.55,'{title,listing,comment}','{chevrolet,pontiac,buick,oldsmobile,gmc}',NULL),
    ('trans_model','muncie','\m(muncie)\M','i',1,0,'MUNCIE',0.55,'{title,listing,comment}',NULL,NULL),
    ('trans_model','th400','\m((?:turbo[- ]?hydra-?matic|th|turbo)[- ]?400|400\s+turbo(?:[- ]?hydra-?matic)?)\M','i',1,0,'TH400',0.55,'{title,listing,comment}',NULL,NULL),
    ('trans_model','th350','\m((?:turbo[- ]?hydra-?matic|th|turbo)[- ]?350|350\s+turbo(?:[- ]?hydra-?matic)?)\M','i',1,0,'TH350',0.50,'{title,listing,comment}',NULL,NULL),
    ('trans_model','th200','\m(th-?200)(?![-]?4r)\M','i',1,0,'TH200',0.50,'{title,listing,comment}',NULL,NULL),
    ('trans_model','200r4','\m(200-?4r)\M','i',1,0,'200R4',0.55,'{title,listing,comment}',NULL,NULL),
    ('trans_model','700r4','\m(700-?r-?4)\M','i',1,0,'700R4',0.55,'{title,listing,comment}',NULL,NULL),
    ('trans_model','4l60','\m(4l60-?e?)\M','i',1,0,'4L60',0.55,'{title,listing,comment}',NULL,NULL),
    ('trans_model','4l80','\m(4l80-?e?)\M','i',1,0,'4L80',0.55,'{title,listing,comment}',NULL,NULL),
    ('trans_model','powerglide','\m(power-?glide)\M','i',1,0,'POWERGLIDE',0.55,'{title,listing,comment}',NULL,NULL),
    ('trans_model','t10','\m(borg[- ]warner\s+(?:super\s+)?t-?10|super\s+t-?10|t-?10\s+(?:four|4)[- ]speed)\M','i',1,0,'T10',0.55,'{title,listing,comment}',NULL,NULL),
    ('trans_model','toploader','\m(top[- ]?loader)\M','i',1,0,'TOPLOADER',0.55,'{title,listing,comment}','{ford,mercury,shelby}',NULL),
    ('trans_model','ford_c6','\m(c-?6)\s+(?:automatic|auto|transmission|cruise|three)','i',1,0,'C6',0.55,'{title,listing,comment}','{ford,mercury,shelby}',NULL),
    ('trans_model','ford_c4','\m(c-?4)\s+(?:automatic|auto|transmission|cruise|three)','i',1,0,'C4',0.55,'{title,listing,comment}','{ford,mercury,shelby}',NULL),
    ('trans_model','ford_fmx','\m(fmx)\M','i',1,0,'FMX',0.55,'{title,listing,comment}','{ford,mercury,shelby}',NULL),
    ('trans_model','cruise_o_matic','\m(cruise-?o-?matic)\M','i',1,0,'CRUISE_O_MATIC',0.50,'{title,listing,comment}','{ford,mercury,shelby}',NULL),
    ('trans_model','tremec','\mtremec\s+(tko|t-?56|t-?5|tkx|magnum)\M','i',1,0,NULL,0.55,'{title,listing,comment}',NULL,NULL),
    ('trans_model','t56','\m(t-?56)\M','i',1,0,'T56',0.50,'{title,listing,comment}',NULL,NULL),
    ('trans_model','saginaw','\m(saginaw)\s+(?:three|four|3|4)[- ]speed','i',1,0,'SAGINAW',0.55,'{title,listing,comment}',NULL,NULL),
    -- axle ratio
    ('axle_ratio','ratio_to_one','\m([2-5]\.[0-9]{2})\s*(?::\s*1|-to-1|\s+to\s+1)\M','i',1,0,NULL,0.65,'{title,listing,comment}',NULL,NULL),
    ('axle_ratio','ratio_before_word','\m([2-5]\.[0-9]{2})\s+(?:ratio\s+)?(?:limited[- ]slip\s+|posi(?:traction)?\s+|safe-?t-?track\s+|traction-?lok\s+)?(?:rear(?:[- ]?end)?|gears?|gearing|ratio|posi(?:traction)?|safe-?t-?track|traction-?lok|limited[- ]slip|differential|diff|axle|rearend|lsd|12-bolt|10-bolt|third member|positraction)\M','i',1,0,NULL,0.60,'{title,listing,comment}',NULL,NULL),
    ('axle_ratio','ratio_after_word','\m(?:rear(?:[- ]end)?|axle|final[- ]drive|differential|gear)\s+ratio\s*(?:of|is|:|-)?\s*([2-5]\.[0-9]{2})\M','i',1,0,NULL,0.60,'{title,listing,comment}',NULL,NULL),
    -- factory paint code (single letter / 1-2 character codes; the 2-digit GM forms are text_code_matches_v1)
    ('paint_code','paint_code_short','(?:[Pp]aint|PAINT|[Cc]olou?r|COLOU?R)\s+(?:[Cc]ode|CODE)\s*(?:is\s+|of\s+|:\s*|#\s*|-\s*)?["“]?([A-Z0-9]{1,2})["”]?(?=[\s,.;)(/]|$)','',1,0,NULL,0.55,'{listing,comment}',NULL,NULL),
    ('paint_code','paint_paren_code','\(\s*(?:[Pp]aint\s+)?(?:[Cc]ode)\s+([A-Z0-9]{1,3})\s*\)','',1,0,NULL,0.45,'{listing,comment}',NULL,NULL),
    -- interior trim code
    ('interior_trim_code','trim_code','\m(?:interior|trim)\s+(?:trim\s+)?(?:tag\s+)?code\s*(?:is\s+|of\s+|:\s*|#\s*|-\s*)?([0-9]{1,3}[A-Z]?|[A-Z][0-9]{1,2}[A-Z]?)(?=[\s,.;)(/]|$)','i',1,0,NULL,0.55,'{listing,comment}',NULL,NULL),
    ('interior_trim_code','trim_number','\mtrim\s+(?:tag\s+)?(?:#|no\.?|number)\s*([0-9]{3}[A-Z]?)\M','i',1,0,NULL,0.55,'{listing,comment}',NULL,NULL),
    -- GM RPO codes (the producer checks bare codes against the RPO dictionaries)
    ('rpo_code','rpo_label','\mRPO\s*(?:code\s*)?[:#]?\s*([A-Z][A-Z0-9]{2})\M','i',1,0,NULL,0.65,'{title,listing,comment}','{chevrolet,pontiac,buick,oldsmobile,gmc,cadillac}',NULL),
    ('rpo_code','rpo_paren','\(\s*(?:RPO\s*)?([A-Z][A-Z0-9]{2})\s*\)','',1,0,NULL,0.60,'{title,listing,comment}','{chevrolet,pontiac,buick,oldsmobile,gmc,cadillac}',NULL),
    ('rpo_code','rpo_bare','\m([A-Z][A-Z0-9]{2})\M','',1,0,NULL,0.50,'{title,listing,comment}','{chevrolet,pontiac,buick,oldsmobile,gmc,cadillac}',NULL),
    -- build date as stated (month + year)
    ('build_date','build_month_year','\m(?:built|build date|assembled|produced|manufactured|rolled off (?:the )?(?:assembly )?line|came off (?:the )?(?:assembly )?line)\s+(?:on\s+|in\s+|during\s+|of\s+|:\s*|was\s+)?(?:the\s+)?(?:(?:first|second|third|fourth|fifth|last|final|1st|2nd|3rd|4th|5th)\s+week\s+of\s+)?(?:late\s+|early\s+|mid-?\s*)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(?:[0-9]{1,2}(?:st|nd|rd|th)?,?\s+)?(?:of\s+)?((?:19|20)[0-9]{2})\M','i',1,2,NULL,0.60,'{listing}',NULL,NULL),
    -- original price as stated
    ('original_msrp','msrp_label','\m(?:original(?:ly)?\s+)?(?:msrp|m\.s\.r\.p\.?|sticker\s+price|window\s+sticker\s+(?:price|total)|list\s+price|retail\s+price|price\s+new|stickered|retailed)\s*(?:new\s+)?(?:of|was|is|:|at|for|totals?|totaling|totaled|came to|reading)?\s*(?:approximately|about|roughly|nearly|just over|just under|over|under|around|an?)?\s*(?:US)?\$\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,7})','i',1,0,NULL,0.60,'{listing}',NULL,NULL),
    ('original_msrp','msrp_base_price','\mbase\s+price\s*(?:of|was|is|:)?\s*(?:approximately|about|roughly|around)?\s*\$\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,7})','i',1,0,NULL,0.40,'{listing}',NULL,NULL),
    ('original_msrp','msrp_after','\$\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,7})(?:\.[0-9]{2})?\s+(?:original\s+)?(?:msrp|sticker(?:\s+price)?|list\s+price)\M','i',1,0,NULL,0.55,'{listing}',NULL,NULL),
    -- selling dealer stated (presence only; the name is not stored)
    ('selling_dealer','sold_new_at','(?:[Ss]old|[Dd]elivered|[Pp]urchased|[Bb]ought|[Oo]rdered|[Rr]etailed)\s+new\s+(?:at|by|through|from|via)\s+(?:the\s+)?([A-Z][A-Za-z0-9&.''-]*(?:\s+[A-Z0-9&][A-Za-z0-9&.''-]*){0,6}?\s+(?:Pontiac|Chevrolet|Chevy|Ford|Motors?|Buick|Oldsmobile|Olds|GMC|Cadillac|Mercury|Lincoln|Sales|Dealership|Automotive|Auto|Company|Co\.|Inc\.?|Garage))\M','',1,0,'STATED',0.60,'{listing}',NULL,NULL),
    ('selling_dealer','dealer_label','(?:[Oo]riginal|[Ss]elling|[Dd]elivering|[Ss]upplying)\s+(?:selling\s+)?dealer(?:ship)?\s+(?:was|is|:|of)\s+([A-Z][A-Za-z0-9&.''-]+(?:\s+[A-Z0-9&][A-Za-z0-9&.''-]*){0,6})','',1,0,'STATED',0.55,'{listing}',NULL,NULL),
    -- Ford DSO (district special order) district
    ('dealer_zone','ford_dso','\mDSO\s*(?:code\s*)?(?:is\s+|of\s+|:\s*|#\s*|-\s*)?([0-9]{2})[0-9A-Z]{0,4}\M','i',1,0,NULL,0.55,'{listing,comment}','{ford,mercury,shelby}',NULL),
    -- documentation present
    ('documentation','doc_phs','\m(PHS|Pontiac Historic(?:al)? Services?)\M','i',1,0,'PHS',0.55,'{title,listing}',NULL,NULL),
    ('documentation','doc_marti','\m(marti\s+(?:report|reports|auto\s+works|documentation|elite|deluxe)|deluxe\s+marti|elite\s+marti)\M','i',1,0,'MARTI',0.55,'{title,listing}',NULL,NULL),
    ('documentation','doc_window_sticker','\m(window\s+sticker|monroney)\M','i',1,0,'WINDOW_STICKER',0.55,'{title,listing}',NULL,NULL),
    ('documentation','doc_build_sheet','\m(build\s+sheet|broadcast\s+sheet)\M','i',1,0,'BUILD_SHEET',0.55,'{title,listing}',NULL,NULL),
    ('documentation','doc_protect_o_plate','\m(protect-?o-?plate)\M','i',1,0,'PROTECT_O_PLATE',0.55,'{title,listing}',NULL,NULL),
    ('documentation','doc_invoice','\m((?:original|factory|dealer)\s+(?:dealer\s+)?invoice|billing\s+history)\M','i',1,0,'ORIGINAL_INVOICE',0.55,'{title,listing}',NULL,NULL),
    ('documentation','doc_order_form','\m((?:dealer|original|factory)\s+order\s+(?:form|copy|sheet))\M','i',1,0,'ORDER_FORM',0.55,'{title,listing}',NULL,NULL),
    ('documentation','doc_gm_heritage','\m(gm\s+heritage(?:\s+center)?|heritage\s+(?:center\s+)?certificate)\M','i',1,0,'GM_HERITAGE',0.55,'{title,listing}',NULL,NULL),
    ('documentation','doc_shelby_registry','\m(saac\s+registry|shelby\s+(?:american\s+)?(?:automobile\s+club\s+)?registry)\M','i',1,0,'SHELBY_REGISTRY',0.55,'{title,listing}',NULL,NULL)
  ),
  q AS (SELECT p.* FROM p WHERE p_text IS NOT NULL AND p_src = ANY (p.srcs)
          AND (p.makes IS NULL OR lower(btrim(p_make)) = ANY (p.makes))
          AND (p.model_re IS NULL OR lower(coalesce(p_model, '')) ~ p.model_re OR lower(btrim(p_make)) = 'shelby')),
  c AS (SELECT q.*, regexp_count(p_text, q.re, 1, q.flags) AS n FROM q),
  m AS (
    SELECT c.kind, c.pattern_key, c.grp, c.fixed, c.base_conf, k.k,
           regexp_instr(p_text, c.re, 1, k.k, 0, c.flags) AS pos,
           regexp_substr(p_text, c.re, 1, k.k, c.flags, 0) AS whole,
           regexp_substr(p_text, c.re, 1, k.k, c.flags, c.grp) AS g1,
           CASE WHEN c.grp2 > 0 THEN regexp_substr(p_text, c.re, 1, k.k, c.flags, c.grp2) END AS g2
      FROM c CROSS JOIN LATERAL generate_series(1, least(c.n, 40)) AS k(k)
     WHERE c.n > 0),
  ctx AS (
    SELECT m.*,
           -- the same sentence before the match, and what follows it
           regexp_replace(substr(p_text, greatest(m.pos - 60, 1), m.pos - greatest(m.pos - 60, 1)), '^.*[.!?;\n•|]', '') AS pre,
           substr(p_text, m.pos + length(m.whole), 40) AS post
      FROM m WHERE m.whole IS NOT NULL),
  norm AS (
    SELECT x.*,
      CASE
        WHEN x.fixed IS NOT NULL THEN x.fixed
        WHEN x.kind = 'trans_speeds' THEN CASE lower(x.g1) WHEN 'three' THEN '3' WHEN 'four' THEN '4' WHEN 'five' THEN '5'
                                                           WHEN 'six' THEN '6' ELSE x.g1 END
        WHEN x.kind = 'trans_type' THEN CASE WHEN lower(x.g1) ~ '^auto' THEN 'AUTOMATIC' ELSE 'MANUAL' END
        WHEN x.kind = 'trim_level' AND x.pattern_key = 'trim_boss' THEN 'BOSS_' || x.g1
        WHEN x.kind = 'trans_model' AND x.pattern_key = 'tremec' THEN
             CASE WHEN lower(x.g1) = 'tko' THEN 'TREMEC_TKO' WHEN lower(x.g1) = 'tkx' THEN 'TREMEC_TKX'
                  WHEN lower(x.g1) = 'magnum' THEN 'TREMEC_MAGNUM' ELSE upper(replace(x.g1, '-', '')) END
        WHEN x.kind = 'build_date' THEN x.g2 || '-' || CASE left(lower(x.g1), 3) WHEN 'jan' THEN '01' WHEN 'feb' THEN '02'
             WHEN 'mar' THEN '03' WHEN 'apr' THEN '04' WHEN 'may' THEN '05' WHEN 'jun' THEN '06' WHEN 'jul' THEN '07'
             WHEN 'aug' THEN '08' WHEN 'sep' THEN '09' WHEN 'oct' THEN '10' WHEN 'nov' THEN '11' WHEN 'dec' THEN '12' END
        WHEN x.kind = 'original_msrp' THEN replace(x.g1, ',', '')
        WHEN x.kind IN ('engine_cid','axle_ratio') THEN x.g1
        ELSE upper(regexp_replace(x.g1, '[^A-Za-z0-9]', '', 'g'))
      END AS code
      FROM ctx x)
  SELECT n.kind, n.code, left(regexp_replace(n.whole, '\s+', ' ', 'g'), 160), n.pos, n.pattern_key, n.base_conf
    FROM norm n
   WHERE n.code IS NOT NULL AND n.code ~ '^[A-Z0-9][A-Z0-9._-]{0,23}$'
     -- ranges
     AND (n.kind <> 'engine_cid' OR n.code::int BETWEEN 140 AND 500)
     AND (n.kind <> 'axle_ratio' OR n.code::numeric BETWEEN 2.20 AND 5.38)
     AND (n.kind <> 'rpo_code' OR (n.code ~ '^[A-Z]' AND n.code ~ '[0-9]'))
     AND (n.kind <> 'interior_trim_code' OR n.code ~ '[0-9]')
     -- tire sizes (F70-14, G60x15, E70 tires) are not RPO codes
     AND NOT (n.kind = 'rpo_code' AND (n.post ~* '^\s*[-x/]?\s*1[2-7]\M' OR n.post ~ '^-?[0-9]' OR n.post ~* '^\s*(tires?|series|radials?|bias|polyglas|wide ?ovals?)'))
     -- a single-letter Ford "A code" must be followed by an engine / car word
     AND NOT (n.kind = 'engine_code' AND n.code = 'A' AND n.post !~* '^\W{0,3}([0-9]{3}|car|mustang|v-?8|4v|2v|engine|motor|fastback|coupe|convertible|hardtop|example)')
     -- trims and engines that are only an appearance, a part, a clone or a comparison
     AND NOT (n.kind IN ('trim_level','body_style') AND (
           n.post ~* '^\s*[-/]?\s*(style|styled|clone|tribute|replica|recreation|re-creation|look|lookalike|inspired|conversion|decals?|stripes?|badges?|badging|emblems?|wheels?|rims?|hood|spoiler|wing|seats?|interior|dash|gauges?|bumpers?|grilles?|nose|front end|parts?|body kit|kit|steering wheel|shaker|scoops?|graphics|appearance|series|racing|race|championship|one|1\M|ford|car club|owners?|forum|registry|top|boot|well|frame|mechanism|motor|pump|tops)\M'
        OR n.pre ~* '\m(clone|tribute|replica|recreation|re-creation|like|resembles?|resembling|similar to|unlike|than|not|isn.t|wasn.t|never|converted (?:in)?to|turned into|made into|to look like|look of|style of|other|removable|detachable|lift-?off|auxiliary|accessory|optional)\s+(?:(?:an?|the)\s+)?(?:(?:real|genuine|true|actual|original|factory)\s+)?$'
        OR n.pre ~* '\mnon-?\s*$'))
     -- trims: mustang plain GT is not GT350 / GT500 / GT/CS, SS is not part of RS/SS-only tokens handled separately
     AND NOT (n.pattern_key = 'trim_mustang_gt' AND n.post ~* '^\s*[-/]?\s*(350|500|cs|ta)\M')
     -- speeds that are not a transmission
     AND NOT (n.kind = 'trans_speeds' AND n.post ~* '^\s*(wipers?|fan|heater|blower|hvac|climate|transfer|axle|rear|blender|bike|bicycle|motor)\M')
     -- documentation and build dates that are denied, wished for, or about another part
     AND NOT (n.kind IN ('documentation','selling_dealer','original_msrp','build_date') AND n.pre ~* '\m(no|not|without|missing|lacks?|lacking|absent|lost|never|nor|unfortunately|isn.t|aren.t|doesn.t|don.t|wasn.t|unavailable|unable|could|can|should|would|recommend|might|may|if)\M')
     AND NOT (n.kind = 'documentation' AND n.post ~* '^\W*(is|are)?\s*(not|available|can be|could be|may be|might|would)\M')
     AND NOT (n.kind = 'build_date' AND n.pre ~* '\m(engine|block|motor|heads?|carb|carburetor|transmission|trans|rear|axle|wheels?|tires?|parts?|radio|alternator|distributor|replacement|restoration|restored|rebuilt|refurbished|dated)\M')
     AND NOT (n.kind = 'original_msrp' AND n.pre ~* '\m(options?|packages?|upgrades?|accessor(?:y|ies))\M')
     AND NOT (n.kind = 'paint_code' AND n.pattern_key = 'paint_paren_code' AND n.pre !~* '(paint|colou?r|red|blue|green|black|white|yellow|orange|gold|silver|gr[ae]y|bronze|brown|maroon|burgundy|metallic|poly|lime|aqua|turquoise|beige|ivory|cream|tan|copper|plum|purple|candy|apple|cameo|starlight|cordova|nugget|sable|ebony|buccaneer|brewster|lucerne|carousel|cardinal|grabber|acapulco|wimbledon)')
$function$;

CREATE OR REPLACE FUNCTION public.data_set_scope_vehicles(p_scope text, p_vehicle uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_scope
    WHEN 'vehicle' THEN ARRAY[p_vehicle]
    WHEN 'pontiac_f_body' THEN (SELECT array_agg(x.id ORDER BY x.id) FROM public.vehicles x
                                 WHERE lower(x.make) = 'pontiac'
                                   AND (lower(coalesce(x.model, '')) ~ 'firebird|trans ?am'
                                        OR upper(btrim(coalesce(x.vin, ''))) ~ '^2[A-Z]87[A-Z][2-9A][A-Z][0-9]{6}$'
                                        OR upper(btrim(coalesce(x.vin, ''))) ~ '^22[3468]87[01][A-Z][0-9]{6}$'
                                        OR upper(btrim(coalesce(x.vin, ''))) ~ '^1G2[A-C][A-Z]87[A-Z][0-9X]B[A-Z][0-9]{6}$'))
    WHEN 'ford_mustang_65_73' THEN (SELECT array_agg(x.id ORDER BY x.id) FROM public.vehicles x
                                 WHERE lower(x.make) = 'ford' AND x.year BETWEEN 1965 AND 1973
                                   AND lower(coalesce(x.model, '')) ~ 'mustang' AND x.deleted_at IS NULL)
    WHEN 'chevrolet_camaro_67_69' THEN (SELECT array_agg(x.id ORDER BY x.id) FROM public.vehicles x
                                 WHERE lower(x.make) = 'chevrolet' AND x.year BETWEEN 1967 AND 1969
                                   AND lower(coalesce(x.model, '')) ~ 'camaro' AND x.deleted_at IS NULL)
    WHEN 'platform_sample_v1' THEN (SELECT array_agg(s.vehicle_id ORDER BY s.vehicle_id) FROM public.coverage_sample_vehicles s
                                 WHERE s.sample_key = 'platform_v1')
  END
$function$;

CREATE OR REPLACE FUNCTION public.field_coverage_snapshot_v1(p_snapshot text, p_phase text, p_scope text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '600s'
AS $function$
DECLARE v_ids uuid[]; v_rows int;
BEGIN
  IF p_snapshot IS NULL OR p_phase IS NULL THEN RAISE EXCEPTION 'field_coverage_snapshot_v1: snapshot and phase required'; END IF;
  v_ids := coalesce(public.data_set_scope_vehicles(p_scope, NULL), '{}');
  WITH veh AS (
    SELECT x.* FROM public.vehicles x WHERE x.id = ANY (v_ids) AND x.deleted_at IS NULL AND x.merged_into_vehicle_id IS NULL),
  f(field, set_kinds, reading_kinds) AS (VALUES
    ('body_style', ARRAY['cowl_style','body_style'], ARRAY['cowl_style','body_style']),
    ('trim_level', ARRAY['vin_series','trim_level'], ARRAY['trim_level']),
    ('engine', ARRAY['vin_engine','engine_code','engine_cid','engine_block_casting'], ARRAY['engine_code','engine_cid','engine_block_casting']),
    ('transmission', ARRAY['trans_type','trans_speeds','trans_model','trans_case_casting','trans_tail_casting'],
                     ARRAY['trans_type','trans_speeds','trans_model','trans_case_casting','trans_tail_casting']),
    ('axle_ratio', ARRAY['axle_ratio'], ARRAY['axle_ratio']),
    ('paint_code', ARRAY['paint_code'], ARRAY['paint_code']),
    ('interior_trim_code', ARRAY['interior_trim_code'], ARRAY['interior_trim_code']),
    ('rpo_option_codes', ARRAY['cowl_option','rpo_code'], ARRAY['cowl_option','rpo_code']),
    ('build_date', ARRAY['build_month'], ARRAY['build_date']),
    ('original_msrp', ARRAY[]::text[], ARRAY['original_msrp']),
    ('dealer_zone', ARRAY['dealer_zone'], ARRAY['selling_dealer','dealer_zone']),
    ('documentation', ARRAY['documentation'], ARRAY['documentation'])),
  per AS (
    SELECT f.field, x.id,
      CASE f.field
        WHEN 'body_style' THEN nullif(btrim(coalesce(x.body_style, x.canonical_body_style, '')), '') IS NOT NULL
        WHEN 'trim_level' THEN nullif(btrim(coalesce(x.trim_level, x.trim, '')), '') IS NOT NULL
        WHEN 'engine' THEN nullif(btrim(coalesce(x.engine_size, x.engine_displacement, x.displacement, x.engine_code, '')), '') IS NOT NULL
                           OR x.engine_liters IS NOT NULL
        WHEN 'transmission' THEN nullif(btrim(coalesce(x.transmission, x.transmission_type, x.transmission_model, x.transmission_code, '')), '') IS NOT NULL
                           OR x.transmission_speeds IS NOT NULL
        WHEN 'axle_ratio' THEN x.rear_axle_ratio IS NOT NULL
        WHEN 'paint_code' THEN nullif(btrim(coalesce(x.paint_code, '')), '') IS NOT NULL
        WHEN 'original_msrp' THEN x.msrp IS NOT NULL
        WHEN 'documentation' THEN (x.documents_on_hand IS NOT NULL AND x.documents_on_hand NOT IN ('null'::jsonb, '[]'::jsonb, '{}'::jsonb))
                           OR coalesce(cardinality(x.numbers_documented_by), 0) > 0
        ELSE false END AS typed,
      EXISTS (SELECT 1 FROM public.data_set_members m JOIN public.data_sets s ON s.id = m.set_id
               WHERE m.vehicle_id = x.id AND m.state = 'active' AND s.set_kind = ANY (f.set_kinds)) AS in_sets,
      EXISTS (SELECT 1 FROM public.vehicle_code_readings r WHERE r.vehicle_id = x.id AND r.state = 'active'
                AND r.kind = ANY (f.reading_kinds)) AS keyed
      FROM veh x CROSS JOIN f),
  notext AS (
    SELECT count(*) AS n FROM veh x
     WHERE coalesce(btrim(x.description), '') = '' AND coalesce(btrim(x.highlights), '') = '' AND coalesce(btrim(x.equipment), '') = ''
       AND NOT EXISTS (SELECT 1 FROM public.vehicle_observations o WHERE o.vehicle_id = x.id AND o.kind::text IN ('listing','specification','provenance')
                         AND o.content_text IS NOT NULL AND NOT coalesce(o.is_superseded, false))
       AND NOT EXISTS (SELECT 1 FROM public.auction_comments ac WHERE ac.vehicle_id = x.id AND ac.comment_type IS DISTINCT FROM 'bid'
                         AND ac.comment_type IS DISTINCT FROM 'sold'))
  INSERT INTO public.field_coverage_snapshots (snapshot_id, phase, cohort, field, n_vehicles, typed, in_sets, keyed, landed, no_text,
    method, logic_version)
  SELECT p_snapshot, p_phase, p_scope, per.field, count(*), count(*) FILTER (WHERE per.typed), count(*) FILTER (WHERE per.in_sets),
         count(*) FILTER (WHERE per.keyed), count(*) FILTER (WHERE per.typed OR per.in_sets OR per.keyed), (SELECT n FROM notext),
         CASE WHEN p_scope = 'platform_sample_v1' THEN 'frozen 0.5% block sample (coverage_sample_vehicles platform_v1)' ELSE 'full cohort scan' END,
         'field_coverage/20261124020000.1'
    FROM per GROUP BY per.field
  ON CONFLICT (snapshot_id, cohort, field) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN (SELECT jsonb_build_object('snapshot', p_snapshot, 'cohort', p_scope, 'rows', v_rows, 'fields',
            jsonb_object_agg(s.field, jsonb_build_object('n', s.n_vehicles, 'typed', s.typed, 'in_sets', s.in_sets, 'keyed', s.keyed,
                                                         'landed', s.landed)))
            FROM public.field_coverage_snapshots s WHERE s.snapshot_id = p_snapshot AND s.cohort = p_scope);
END
$function$;

CREATE OR REPLACE FUNCTION public.spec_landing_drain_v1(p_budget_ms integer DEFAULT 40000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE j public.spec_landing_jobs%ROWTYPE; r jsonb; t0 timestamptz := clock_timestamp(); n int := 0; v_done boolean;
        v_log jsonb := '[]'::jsonb;
BEGIN
  LOOP
    EXIT WHEN clock_timestamp() - t0 > make_interval(secs => p_budget_ms / 1000.0);
    SELECT s.* INTO j FROM public.spec_landing_jobs s
     WHERE s.status IN ('queued','running')
       AND (s.depends_on IS NULL OR EXISTS (SELECT 1 FROM public.spec_landing_jobs d WHERE d.job_id = s.depends_on AND d.status = 'done'))
     ORDER BY s.priority, s.created_at, s.job_id
     FOR UPDATE SKIP LOCKED LIMIT 1;
    EXIT WHEN NOT FOUND;
    BEGIN
      IF j.step_kind = 'decode' THEN
        r := public.text_code_decode_v2(j.run_id, j.scope, NULL, j.batch, j.next_from, j.step);
        v_done := coalesce((r->>'done')::boolean, false);
      ELSIF j.step_kind = 'plan' THEN
        r := public.data_set_membership_plan_v2(j.run_id, j.scope, NULL, j.kinds, j.next_from, j.step);
        v_done := coalesce((r->>'done')::boolean, false);
      ELSE
        r := public.data_set_membership_apply_v1(j.run_id, j.batch, greatest(1, least(200, j.step)), false);
        v_done := coalesce((r->>'still_planned')::int, 1) = 0;
      END IF;
      UPDATE public.spec_landing_jobs s
         SET next_from = coalesce((r->>'next_from')::int, s.next_from), status = CASE WHEN v_done THEN 'done' ELSE 'running' END,
             last_result = r, ticks = s.ticks + 1, updated_at = now(), done_at = CASE WHEN v_done THEN now() END
       WHERE s.job_id = j.job_id;
      v_log := v_log || jsonb_build_object('job', j.job_id, 'from', j.next_from, 'done', v_done);
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.spec_landing_jobs s
         SET errors = s.errors + 1, last_error = left(SQLERRM, 500), step = greatest(s.step / 2, 1),
             status = CASE WHEN s.errors + 1 >= 5 THEN 'failed' ELSE s.status END, updated_at = now()
       WHERE s.job_id = j.job_id;
      v_log := v_log || jsonb_build_object('job', j.job_id, 'from', j.next_from, 'error', left(SQLERRM, 200));
      EXIT;
    END;
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('steps', n, 'ms', round(extract(epoch FROM clock_timestamp() - t0) * 1000), 'log', v_log);
END
$function$;

commit;
