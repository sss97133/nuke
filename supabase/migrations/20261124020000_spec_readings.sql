-- Factory-record spec readings (20261124020000)
-- Keys the factory-record fields that listing text states but no typed column holds: body style, trim level, engine
-- displacement and Ford engine letter, transmission type / speeds / model, axle ratio, short paint codes, interior trim
-- code, GM RPO codes, build month, original price, selling dealer (presence only), Ford DSO district and documentation
-- present (PHS, Marti, window sticker, build sheet, Protect-O-Plate, invoice, order form, GM Heritage, Shelby registry).
--  1. vehicle_code_readings takes the new kinds; codes may carry '.', '_' and '-' (3.42, TRANS_AM, 1973-07) and may be one
--     character (Ford paint T, engine R). Origins add vehicle_observations (listing text) and field_evidence (extracted values).
--  2. text_spec_matches_v2 is the deterministic reader (regex + dictionaries; no model, nothing guessed). Denied, wished-for,
--     clone / tribute / part-only and comparison mentions are dropped. Bare GM RPO codes count only when the RPO dictionary
--     lists them for that make and year.
--  3. text_code_decode_v2: run-stamped, sliced producer over the Pontiac F-body, 1965-73 Mustang and 1967-69 Camaro scopes.
--     It also runs text_code_matches_v1 so the casting / paint / style / cowl-option readings reach the new cohorts.
--     Revert with text_code_decode_revert_v1(run) (backs rows up, then deletes the run's rows).
--  4. data_set_code_key_v1 keys every reading kind; data_set_code_candidates_v1 turns readings into memberships;
--     data_set_membership_plan_v2 plans only code-reading memberships for chosen kinds (sliced). Apply and revert are the
--     existing data_set_membership_apply_v1 / data_set_membership_revert_v1.
--  5. field_coverage_snapshots + field_coverage_snapshot_v1: per-field typed / in-set / keyed counts for a cohort, so the
--     before / after of every run is a stored row, not a report.
-- Revert: supabase/sql/revert_20261124020000_spec_readings.sql (revert membership runs, then reading runs, first).

begin;
set local lock_timeout = '5s';
set local statement_timeout = '300s';

ALTER TABLE public.vehicle_code_readings DROP CONSTRAINT IF EXISTS vehicle_code_readings_kind_check;
ALTER TABLE public.vehicle_code_readings ADD CONSTRAINT vehicle_code_readings_kind_check CHECK (kind IN (
  'engine_block_casting','engine_code','trans_case_casting','trans_tail_casting','paint_code','cowl_style','cowl_option',
  'body_style','trim_level','engine_cid','trans_type','trans_speeds','trans_model','axle_ratio','interior_trim_code',
  'rpo_code','build_date','original_msrp','selling_dealer','dealer_zone','documentation'));
ALTER TABLE public.vehicle_code_readings DROP CONSTRAINT IF EXISTS vehicle_code_readings_code_check;
ALTER TABLE public.vehicle_code_readings ADD CONSTRAINT vehicle_code_readings_code_check
  CHECK (code ~ '^[A-Z0-9][A-Z0-9._-]{0,23}$');
ALTER TABLE public.vehicle_code_readings DROP CONSTRAINT IF EXISTS vehicle_code_readings_origin_table_check;
ALTER TABLE public.vehicle_code_readings ADD CONSTRAINT vehicle_code_readings_origin_table_check
  CHECK (origin_table IN ('vehicles','auction_comments','vehicle_observations','field_evidence'));
COMMENT ON TABLE public.vehicle_code_readings IS
  'Codes and factory-record values read from landed text (text_code_decode_v1 / v2). Each row is an inference citing its origin '
  'row and column with a confidence; match_text is the matched span for listing text only, NULL for comments and for the '
  'selling dealer (no comment text, author or dealer name is stored).';

-- text_code_rescore_v1 updates members by the reading they cite
CREATE INDEX IF NOT EXISTS data_set_members_code_basis_idx ON public.data_set_members (basis_id)
  WHERE state = 'active' AND basis_type = 'code_reading';

ALTER TABLE public.data_sets DROP CONSTRAINT IF EXISTS data_sets_set_kind_check;
ALTER TABLE public.data_sets ADD CONSTRAINT data_sets_set_kind_check CHECK (set_kind IN ('vin_cohort','vin_series','vin_engine',
  'plant_year','cowl_style','cowl_option','engine_block_casting','engine_code','trans_case_casting','trans_tail_casting','paint_code',
  'replica_cohort','comment_theme','body_style','trim_level','engine_cid','trans_type','trans_speeds','trans_model','axle_ratio',
  'interior_trim_code','rpo_code','build_month','dealer_zone','documentation'));

-- text_spec_matches_v2: deterministic factory-record field reader. One row per accepted match; nothing is guessed.
--   p_src: 'title' (listing title), 'lead' (first 400 characters of the description), 'listing' (listing text columns),
--   'comment' (a non-bid auction comment). Each pattern lists the sources it may read and the makes / models it applies to.
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

-- Scopes: the Pontiac F-body set is unchanged; two muscle-car cohorts and a frozen platform sample are added.
CREATE TABLE IF NOT EXISTS public.coverage_sample_vehicles (
  sample_key text NOT NULL,
  vehicle_id uuid NOT NULL,
  drawn_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sample_key, vehicle_id)
);
COMMENT ON TABLE public.coverage_sample_vehicles IS
  'Frozen vehicle samples for coverage measurement (20261124020000). platform_v1 = TABLESAMPLE SYSTEM (0.5) REPEATABLE (20261123) '
  'of live vehicles, drawn once so before / after counts compare the same cars.';
ALTER TABLE public.coverage_sample_vehicles ENABLE ROW LEVEL SECURITY;
INSERT INTO public.coverage_sample_vehicles (sample_key, vehicle_id)
SELECT 'platform_v1', x.id FROM public.vehicles x TABLESAMPLE SYSTEM (0.5) REPEATABLE (20261123)
 WHERE x.deleted_at IS NULL AND x.merged_into_vehicle_id IS NULL
ON CONFLICT DO NOTHING;

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

-- Kinds that hold several true values at once (no conflict penalty): options, documents, and transmission names that
-- overlap (MUNCIE and M21 are one gearbox), and trims that stack (RS/SS).
CREATE OR REPLACE FUNCTION public.text_code_rescore_v1(p_vehicles uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n int; n_m int;
BEGIN
  WITH k AS (
    SELECT r.id, CASE WHEN r.kind NOT IN ('cowl_option','rpo_code','documentation','trans_model','selling_dealer','trim_level')
                       AND max(r.code) OVER (PARTITION BY r.vehicle_id, r.kind) <> min(r.code) OVER (PARTITION BY r.vehicle_id, r.kind)
                      THEN round(r.base_confidence * 0.6, 3) ELSE r.base_confidence END AS c
      FROM public.vehicle_code_readings r WHERE r.vehicle_id = ANY (p_vehicles) AND r.state = 'active'),
  u AS (UPDATE public.vehicle_code_readings r SET confidence = k.c FROM k WHERE r.id = k.id AND r.confidence IS DISTINCT FROM k.c
        RETURNING 1)
  SELECT count(*) INTO n FROM u;
  WITH u AS (
    UPDATE public.data_set_members m SET confidence = r.confidence
      FROM public.vehicle_code_readings r
     WHERE m.basis_type = 'code_reading' AND m.basis_id = r.id AND m.state = 'active'
       AND r.vehicle_id = ANY (p_vehicles) AND r.state = 'active' AND m.confidence IS DISTINCT FROM r.confidence
    RETURNING 1)
  SELECT count(*) INTO n_m FROM u;
  RETURN n + n_m;
END
$function$;

-- Bare RPO codes count only when the dictionary lists them for the car's make and year.
CREATE OR REPLACE FUNCTION public.text_rpo_known_v1(p_code text, p_make text, p_year integer, p_bare boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_year IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.vintage_rpo_codes d
             WHERE d.rpo_code = p_code AND d.manufacturer = 'GM' AND coalesce(d.description, '') !~* '^mined from'
               AND d.makes IS NOT NULL AND initcap(p_make) = ANY (d.makes)
               AND (d.first_year IS NULL OR d.first_year <= p_year) AND (d.last_year IS NULL OR d.last_year >= p_year))
    OR (NOT p_bare AND EXISTS (SELECT 1 FROM public.gm_rpo_library g
             WHERE g.rpo_code = p_code AND (g.first_year IS NULL OR g.first_year <= p_year)
               AND (g.last_year IS NULL OR g.last_year >= p_year))))
$function$;

CREATE OR REPLACE FUNCTION public.text_code_decode_v2(p_run uuid, p_scope text DEFAULT 'pontiac_f_body'::text, p_vehicle uuid DEFAULT NULL::uuid,
  p_batch integer DEFAULT 200, p_from integer DEFAULT 1, p_count integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '900s'
AS $function$
DECLARE v_ids uuid[]; v_chunk uuid[]; i int; v_end int; n int := 0; b int := 0;
BEGIN
  IF p_run IS NULL THEN RAISE EXCEPTION 'text_code_decode_v2: run required'; END IF;
  IF p_scope NOT IN ('vehicle','pontiac_f_body','ford_mustang_65_73','chevrolet_camaro_67_69','platform_sample_v1') THEN
    RAISE EXCEPTION 'text_code_decode_v2: unknown scope %', p_scope;
  END IF;
  IF p_scope = 'vehicle' AND p_vehicle IS NULL THEN RAISE EXCEPTION 'text_code_decode_v2: scope vehicle needs a vehicle'; END IF;
  IF p_batch NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'text_code_decode_v2: batch must be 1..1000'; END IF;
  IF p_from IS NULL OR p_from < 1 THEN RAISE EXCEPTION 'text_code_decode_v2: p_from starts at 1'; END IF;
  IF p_from = 1 AND EXISTS (SELECT 1 FROM public.vehicle_code_reading_runs r WHERE r.run_id = p_run::text) THEN
    RAISE EXCEPTION 'text_code_decode_v2: run % already exists', p_run;
  END IF;
  IF p_from > 1 AND NOT EXISTS (SELECT 1 FROM public.vehicle_code_reading_runs r WHERE r.run_id = p_run::text
                                   AND r.status = 'applying' AND r.scope = p_scope AND r.producer = 'text_code_decode_v2') THEN
    RAISE EXCEPTION 'text_code_decode_v2: run % is not open for scope %', p_run, p_scope;
  END IF;
  SELECT array_agg(x ORDER BY x) INTO v_ids FROM unnest(coalesce(public.data_set_scope_vehicles(p_scope, p_vehicle), '{}')) x
   WHERE x::text NOT LIKE '9cf5b7a4%';
  v_ids := coalesce(v_ids, '{}');
  IF p_from = 1 THEN
    INSERT INTO public.vehicle_code_reading_runs (run_id, producer, logic_version, scope, n_vehicles)
    VALUES (p_run::text, 'text_code_decode_v2', 'text_code_decode/20261124020000.1', p_scope, cardinality(v_ids));
  END IF;
  i := p_from;
  v_end := least(cardinality(v_ids), CASE WHEN p_count IS NULL THEN cardinality(v_ids) ELSE p_from + p_count - 1 END);
  WHILE i <= v_end LOOP
    v_chunk := v_ids[i : least(i + p_batch - 1, v_end)];
    WITH veh AS (
      SELECT x.* FROM public.vehicles x
       WHERE x.id = ANY (v_chunk) AND x.deleted_at IS NULL AND x.merged_into_vehicle_id IS NULL
         AND x.status IS DISTINCT FROM 'merged' AND x.make IS NOT NULL),
    src AS (
      -- listing text on the vehicle row: titles, the description's opening (body / trim), and the listing text columns
      SELECT x.id AS vehicle_id, x.year, x.make, x.model, x.is_replica, 'vehicles'::text AS ot, x.id AS oid, c.col, c.s, c.txt,
             1.0::numeric AS f
        FROM veh x
       CROSS JOIN LATERAL (VALUES ('listing_title', 'title', x.listing_title), ('bat_listing_title', 'title', x.bat_listing_title),
                                  ('title', 'title', x.title), ('description', 'lead', left(x.description, 400)),
                                  ('description', 'listing', x.description), ('highlights', 'listing', x.highlights),
                                  ('equipment', 'listing', x.equipment), ('modifications', 'listing', x.modifications),
                                  ('numbers_quote', 'listing', x.numbers_quote)) c(col, s, txt)
       WHERE c.txt IS NOT NULL AND btrim(c.txt) <> ''
      UNION ALL
      -- listing captures kept as observations (eBay, dealer pages, archived listings)
      SELECT x.id, x.year, x.make, x.model, x.is_replica, 'vehicle_observations', o.id, 'content_text', 'listing', o.content_text, 1.0
        FROM veh x JOIN public.vehicle_observations o ON o.vehicle_id = x.id
       WHERE o.kind::text IN ('listing','specification','provenance') AND NOT coalesce(o.is_superseded, false)
         AND o.content_text IS NOT NULL AND length(o.content_text) BETWEEN 20 AND 60000
      UNION ALL
      -- extracted field values: short structured strings, read like a title
      SELECT x.id, x.year, x.make, x.model, x.is_replica, 'field_evidence', f.id, 'proposed_value', 'title', f.proposed_value, 0.9
        FROM veh x JOIN public.field_evidence f ON f.vehicle_id = x.id
       WHERE f.field_name IN ('transmission','transmission_speeds','transmission_details','body_style','body_type','trim','series',
                              'engine_size','engine_displacement','engine_type','engine','engine_code','factory_engine','factory_engine_code')
         AND coalesce(f.status, '') NOT IN ('rejected','superseded') AND f.proposed_value IS NOT NULL
         AND length(f.proposed_value) BETWEEN 2 AND 300
      UNION ALL
      SELECT x.id, x.year, x.make, x.model, x.is_replica, 'auction_comments', ac.id, 'comment_text', 'comment', ac.comment_text, 0.6
        FROM veh x JOIN public.auction_comments ac ON ac.vehicle_id = x.id
       WHERE ac.comment_type IS DISTINCT FROM 'bid' AND ac.comment_type IS DISTINCT FROM 'sold' AND ac.comment_text IS NOT NULL
         -- a question states nothing about the car
         AND ac.has_question IS NOT TRUE
         AND (ac.comment_text ~* '(code|rpo|ratio|gear|posi|muncie|turbo|th-?[234]00|glide|m-?2[012]|t-?10|loader|fmx|paint|trim|axle|dso|casting|stamp|tag|case|housing|[2-5]\.[0-9]{2})'
              OR ac.comment_text ~ '\m[A-Z](?:[0-9][A-Z0-9]|[A-Z][0-9])\M')),
    hits AS (
      SELECT s.vehicle_id, s.year, lower(btrim(s.make)) AS mk, s.is_replica, s.ot, s.oid, s.col, s.s, s.f,
             t.kind, t.code, t.match_text, t.match_offset, t.pattern_key, t.base_conf
        FROM src s CROSS JOIN LATERAL public.text_spec_matches_v2(s.txt, s.s, s.make, s.model) t
      UNION ALL
      SELECT s.vehicle_id, s.year, lower(btrim(s.make)), s.is_replica, s.ot, s.oid, s.col, s.s, s.f,
             t.kind, t.code, t.match_text, NULL::int, t.pattern_key, t.base_conf
        FROM src s CROSS JOIN LATERAL public.text_code_matches_v1(s.txt) t
       WHERE s.s IN ('listing','comment')),
    ok AS (
      SELECT h.* FROM hits h
       WHERE h.code ~ '^[A-Z0-9][A-Z0-9._-]{0,23}$'
         -- Pontiac engine stamps must be a cited code for that year; Ford letters are read for 1960-79 cars only
         AND (h.kind <> 'engine_code' OR (h.pattern_key = 'ford_letter_code' AND h.year BETWEEN 1960 AND 1979) OR EXISTS (
               SELECT 1 FROM public.vehicle_decode_rules d WHERE d.rule_key = 'engine_stamp_code' AND d.superseded_at IS NULL
                  AND lower(d.make) = h.mk AND upper(d.code) = h.code AND d.year_min <= h.year AND d.year_max >= h.year))
         AND (h.kind NOT IN ('paint_code','cowl_style','cowl_option','body_style','trim_level','rpo_code','interior_trim_code',
                             'documentation','build_date','original_msrp') OR h.year IS NOT NULL)
         AND (h.kind <> 'trim_level' OR h.is_replica IS NOT TRUE)
         AND (h.kind <> 'rpo_code' OR h.pattern_key = 'rpo_label'
              OR public.text_rpo_known_v1(h.code, h.mk, h.year, h.pattern_key = 'rpo_bare'))
         AND (h.kind <> 'build_date' OR left(h.code, 4)::int BETWEEN h.year - 1 AND h.year)
         AND (h.kind <> 'original_msrp' OR (h.year < 1990 AND h.code::bigint BETWEEN 1500 AND 150000)
              OR (h.year >= 1990 AND h.code::bigint BETWEEN 5000 AND 5000000))),
    one AS (
      SELECT DISTINCT ON (o.vehicle_id, o.kind, o.code, o.ot, o.oid, o.col) o.*
        FROM ok o ORDER BY o.vehicle_id, o.kind, o.code, o.ot, o.oid, o.col, o.base_conf * o.f DESC, o.pattern_key)
    INSERT INTO public.vehicle_code_readings (vehicle_id, kind, code, model_year, origin_table, origin_id, origin_column, match_text,
      match_offset, pattern_key, confidence, base_confidence, rule_version, run_id)
    SELECT o.vehicle_id, o.kind, o.code, o.year, o.ot, o.oid, o.col,
           CASE WHEN o.ot IN ('vehicles','vehicle_observations','field_evidence') AND o.kind <> 'selling_dealer' THEN o.match_text END,
           CASE WHEN o.ot IN ('vehicles','vehicle_observations','field_evidence') THEN o.match_offset END,
           o.pattern_key, round(o.base_conf * o.f, 3), round(o.base_conf * o.f, 3), 'text_code_decode_v2', p_run::text
      FROM one o
    ON CONFLICT (vehicle_id, kind, code, origin_table, origin_id, origin_column) WHERE state = 'active' DO NOTHING;
    GET DIAGNOSTICS b = ROW_COUNT;
    n := n + b;
    PERFORM public.text_code_rescore_v1(v_chunk);
    i := i + p_batch;
  END LOOP;
  IF v_end < cardinality(v_ids) THEN
    RETURN jsonb_build_object('run_id', p_run, 'vehicles', cardinality(v_ids), 'inserted_this_slice', n, 'next_from', v_end + 1, 'done', false);
  END IF;
  UPDATE public.vehicle_code_reading_runs SET status = 'applied', applied_at = now(),
         summary = jsonb_build_object('inserted', (SELECT count(*) FROM public.vehicle_code_readings r WHERE r.run_id = p_run::text),
           'by_kind', (SELECT jsonb_object_agg(k, c) FROM (SELECT r.kind || ':' || r.origin_table AS k, count(*) AS c
                         FROM public.vehicle_code_readings r WHERE r.run_id = p_run::text GROUP BY 1) z),
           'vehicles_with_readings', (SELECT count(DISTINCT r.vehicle_id) FROM public.vehicle_code_readings r WHERE r.run_id = p_run::text))
   WHERE run_id = p_run::text;
  RETURN (SELECT jsonb_build_object('run_id', run_id, 'vehicles', n_vehicles, 'done', true, 'inserted_this_slice', n) || summary
            FROM public.vehicle_code_reading_runs WHERE run_id = p_run::text);
END
$function$;

-- One set key per reading. Earlier kinds keep their exact keys; NULL = keyed reading that does not fold into a set.
CREATE OR REPLACE FUNCTION public.data_set_code_key_v1(p_kind text, p_mk text, p_year integer, p_code text)
 RETURNS TABLE(set_kind text, set_key text, rule_key text)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN p_kind = 'build_date' THEN 'build_month' ELSE p_kind END, lower(k.key), k.rk
    FROM (SELECT CASE
            WHEN p_mk IS NULL OR p_code IS NULL THEN NULL
            WHEN p_kind = 'engine_code' THEN format('%s:%s', p_mk, p_code)
            WHEN p_kind IN ('engine_block_casting','trans_case_casting','trans_tail_casting') THEN p_code
            WHEN p_kind = 'cowl_style' AND p_year IS NOT NULL THEN format('%s:%s', p_year, p_code)
            WHEN p_kind IN ('paint_code','cowl_option','body_style','trim_level','rpo_code','interior_trim_code','documentation')
                 AND p_year IS NOT NULL THEN format('%s:%s:%s', p_mk, p_year, p_code)
            WHEN p_kind IN ('engine_cid','trans_type','trans_speeds','trans_model','axle_ratio','dealer_zone')
                 THEN format('%s:%s', p_mk, p_code)
            WHEN p_kind = 'build_date' AND p_code ~ '^[0-9]{4}-[0-9]{2}' THEN format('%s:%s', p_mk, left(p_code, 7))
          END AS key,
          CASE p_kind WHEN 'engine_block_casting' THEN 'block_casting' WHEN 'engine_code' THEN 'engine_stamp_code'
                      WHEN 'trans_case_casting' THEN 'transmission_case_casting'
                      WHEN 'trans_tail_casting' THEN 'transmission_tailhousing_casting'
                      WHEN 'paint_code' THEN 'body_tag_paint_code' WHEN 'cowl_style' THEN 'body_tag_style_number'
                      WHEN 'cowl_option' THEN 'body_tag_option_code' END AS rk) k
   WHERE k.key IS NOT NULL
$function$;

CREATE OR REPLACE FUNCTION public.data_set_code_candidates_v1(p_vehicles uuid[], p_kinds text[] DEFAULT NULL::text[])
 RETURNS TABLE(set_kind text, set_key text, set_label text, set_provenance jsonb, member_type text, member_id uuid, vehicle_id uuid,
               basis_type text, basis_id uuid, basis_detail jsonb, confidence numeric, member_rule_version text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH v AS (
    SELECT x.id, lower(btrim(x.make)) AS mk
      FROM public.vehicles x
     WHERE x.id = ANY (p_vehicles) AND x.deleted_at IS NULL AND x.merged_into_vehicle_id IS NULL
       AND x.status IS DISTINCT FROM 'merged' AND x.make IS NOT NULL),
  crd AS (
    SELECT r.id, r.vehicle_id, r.kind, upper(r.code) AS code, r.model_year, r.confidence AS conf, v.mk,
           r.origin_table, r.origin_id, r.origin_column, r.rule_version
      FROM public.vehicle_code_readings r JOIN v ON v.id = r.vehicle_id
     WHERE r.state = 'active' AND (p_kinds IS NULL OR r.kind = ANY (p_kinds))),
  keyed AS (
    SELECT c.*, k.set_kind, k.set_key,
           CASE WHEN k.rule_key IS NOT NULL THEN public.data_set_rule_label(k.rule_key, c.mk, c.code,
                  CASE WHEN c.kind IN ('paint_code','cowl_style','cowl_option') THEN c.model_year END)
                WHEN c.kind = 'rpo_code' THEN (
                  SELECT jsonb_build_object('source', 'vintage_rpo_codes',
                           'label', CASE WHEN count(DISTINCT d.description) = 1 THEN min(d.description) END)
                    FROM public.vintage_rpo_codes d
                   WHERE d.rpo_code = c.code AND d.manufacturer = 'GM' AND coalesce(d.description, '') !~* '^mined from'
                     AND d.makes IS NOT NULL AND initcap(c.mk) = ANY (d.makes)
                     AND (d.first_year IS NULL OR d.first_year <= c.model_year) AND (d.last_year IS NULL OR d.last_year >= c.model_year))
           END AS lbl
      FROM crd c CROSS JOIN LATERAL public.data_set_code_key_v1(c.kind, c.mk, c.model_year, c.code) k)
  SELECT k.set_kind, k.set_key, k.lbl->>'label', jsonb_build_object('decode_rule', k.rule_version, 'rules', k.lbl),
         'vehicle'::text, k.vehicle_id, k.vehicle_id, 'code_reading'::text, k.id,
         jsonb_build_object('code', k.code, 'origin_table', k.origin_table, 'origin_id', k.origin_id,
                            'origin_column', k.origin_column), k.conf, k.rule_version
    FROM keyed k
$function$;

-- Plans code-reading memberships only, for the reading kinds given, in vehicle slices (one run, many calls).
-- Supersedes only this producer's own kind of member (basis code_reading, set kinds of p_kinds) on the slice's vehicles.
CREATE OR REPLACE FUNCTION public.data_set_membership_plan_v2(p_run uuid, p_scope text, p_vehicle uuid DEFAULT NULL::uuid,
  p_kinds text[] DEFAULT NULL::text[], p_from integer DEFAULT 1, p_count integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '600s'
AS $function$
DECLARE v_all uuid[]; v_ids uuid[]; v_end int; n_add int; n_sup int; n_cand int; v_kinds text[]; v_set_kinds text[];
BEGIN
  IF p_run IS NULL THEN RAISE EXCEPTION 'data_set_membership_plan_v2: run required'; END IF;
  IF p_scope NOT IN ('vehicle','pontiac_f_body','ford_mustang_65_73','chevrolet_camaro_67_69','platform_sample_v1') THEN
    RAISE EXCEPTION 'data_set_membership_plan_v2: unknown scope %', p_scope;
  END IF;
  IF p_scope = 'vehicle' AND p_vehicle IS NULL THEN RAISE EXCEPTION 'data_set_membership_plan_v2: scope vehicle needs a vehicle'; END IF;
  IF p_from IS NULL OR p_from < 1 THEN RAISE EXCEPTION 'data_set_membership_plan_v2: p_from starts at 1'; END IF;
  v_kinds := coalesce(p_kinds, ARRAY['engine_block_casting','engine_code','trans_case_casting','trans_tail_casting','paint_code',
    'cowl_style','cowl_option','body_style','trim_level','engine_cid','trans_type','trans_speeds','trans_model','axle_ratio',
    'interior_trim_code','rpo_code','build_date','dealer_zone','documentation']);
  v_set_kinds := ARRAY(SELECT CASE WHEN k = 'build_date' THEN 'build_month' ELSE k END FROM unnest(v_kinds) k);
  IF p_from = 1 THEN
    IF EXISTS (SELECT 1 FROM public.data_set_runs r WHERE r.run_id = p_run::text) THEN
      RAISE EXCEPTION 'data_set_membership_plan_v2: run % already planned', p_run;
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.data_set_runs r WHERE r.run_id = p_run::text AND r.status = 'planned'
                       AND r.producer = 'data_set_membership_v2' AND r.scope = p_scope
                       AND r.summary->'kinds' = to_jsonb(v_kinds)) THEN
    RAISE EXCEPTION 'data_set_membership_plan_v2: run % is not open for scope % and these kinds', p_run, p_scope;
  END IF;
  v_all := coalesce(public.data_set_scope_vehicles(p_scope, p_vehicle), '{}');
  v_end := least(cardinality(v_all), CASE WHEN p_count IS NULL THEN cardinality(v_all) ELSE p_from + p_count - 1 END);
  v_ids := coalesce(v_all[p_from : v_end], '{}');
  IF p_from = 1 THEN
    INSERT INTO public.data_set_runs (run_id, producer, logic_version, scope, vehicle_id, n_vehicles, summary)
    VALUES (p_run::text, 'data_set_membership_v2', 'data_set_membership/20261124020000.1', p_scope, p_vehicle, cardinality(v_all),
            jsonb_build_object('kinds', to_jsonb(v_kinds)));
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.data_set_cand2 (LIKE public.data_set_member_plan INCLUDING DEFAULTS) ON COMMIT DROP;
  TRUNCATE pg_temp.data_set_cand2;
  INSERT INTO pg_temp.data_set_cand2 (id, run_id, action, set_kind, set_key, set_label, set_provenance, member_type, member_id,
    vehicle_id, basis_type, basis_id, basis_detail, confidence, member_rule_version)
  SELECT 0, p_run::text, 'add', c.set_kind, c.set_key, c.set_label, c.set_provenance, c.member_type, c.member_id,
         c.vehicle_id, c.basis_type, c.basis_id, c.basis_detail, c.confidence, c.member_rule_version
    FROM (SELECT DISTINCT ON (c0.set_kind, c0.set_key, c0.member_type, c0.member_id, c0.basis_type, c0.basis_id) c0.*
            FROM public.data_set_code_candidates_v1(v_ids, v_kinds) c0
           ORDER BY c0.set_kind, c0.set_key, c0.member_type, c0.member_id, c0.basis_type, c0.basis_id, c0.confidence DESC) c;
  GET DIAGNOSTICS n_cand = ROW_COUNT;
  ANALYZE pg_temp.data_set_cand2;

  INSERT INTO public.data_set_member_plan (run_id, action, set_kind, set_key, set_label, set_provenance, member_type, member_id,
    vehicle_id, basis_type, basis_id, basis_detail, confidence, member_rule_version)
  SELECT c.run_id, 'add', c.set_kind, c.set_key, c.set_label, c.set_provenance, c.member_type, c.member_id,
         c.vehicle_id, c.basis_type, c.basis_id, c.basis_detail, c.confidence, c.member_rule_version
    FROM pg_temp.data_set_cand2 c
   WHERE NOT EXISTS (SELECT 1 FROM public.data_set_members m JOIN public.data_sets s ON s.id = m.set_id
                      WHERE m.state = 'active' AND s.set_kind = c.set_kind AND s.set_key = c.set_key
                        AND s.rule_version = 'data_set_keys_v1' AND m.member_type = c.member_type
                        AND m.member_id = c.member_id AND m.basis_type = c.basis_type AND m.basis_id = c.basis_id)
   ORDER BY c.vehicle_id, c.set_kind, c.set_key, c.member_type, c.member_id;
  GET DIAGNOSTICS n_add = ROW_COUNT;

  INSERT INTO public.data_set_member_plan (run_id, action, set_kind, set_key, member_type, member_id, vehicle_id, basis_type,
    basis_id, basis_detail, confidence, member_rule_version, target_member_id)
  SELECT p_run::text, 'supersede', s.set_kind, s.set_key, m.member_type, m.member_id, m.vehicle_id, m.basis_type,
         m.basis_id, m.basis_detail, m.confidence, m.rule_version, m.id
    FROM public.data_set_members m JOIN public.data_sets s ON s.id = m.set_id
   WHERE m.state = 'active' AND m.vehicle_id = ANY (v_ids) AND m.basis_type = 'code_reading' AND s.set_kind = ANY (v_set_kinds)
     AND NOT EXISTS (SELECT 1 FROM pg_temp.data_set_cand2 c
                      WHERE c.set_kind = s.set_kind AND c.set_key = s.set_key AND c.member_type = m.member_type
                        AND c.member_id = m.member_id AND c.basis_type = m.basis_type AND c.basis_id = m.basis_id)
   ORDER BY m.id;
  GET DIAGNOSTICS n_sup = ROW_COUNT;

  UPDATE public.data_set_runs SET summary = summary || jsonb_build_object(
           'candidates', coalesce((summary->>'candidates')::int, 0) + n_cand,
           'planned_add', coalesce((summary->>'planned_add')::int, 0) + n_add,
           'planned_supersede', coalesce((summary->>'planned_supersede')::int, 0) + n_sup,
           'planned_through', v_end)
   WHERE run_id = p_run::text;
  RETURN jsonb_build_object('run_id', p_run, 'scope', p_scope, 'vehicles', cardinality(v_all), 'slice_vehicles', cardinality(v_ids),
    'candidates', n_cand, 'planned_add', n_add, 'planned_supersede', n_sup,
    'next_from', CASE WHEN v_end < cardinality(v_all) THEN v_end + 1 END, 'done', v_end >= cardinality(v_all));
END
$function$;

-- Coverage: one stored row per (snapshot, cohort, field). typed = a vehicles column holds it; in_sets = an active membership
-- in a set kind for that field; keyed = an active vehicle_code_readings row; landed = any of the three.
-- no_text = the vehicle has no listing text, no listing observation and no non-bid comment at all (nothing to read).
CREATE TABLE IF NOT EXISTS public.field_coverage_snapshots (
  id bigserial PRIMARY KEY,
  snapshot_id text NOT NULL,
  phase text NOT NULL,
  cohort text NOT NULL,
  field text NOT NULL,
  n_vehicles integer NOT NULL,
  typed integer NOT NULL,
  in_sets integer NOT NULL,
  keyed integer NOT NULL,
  landed integer NOT NULL,
  no_text integer,
  method text NOT NULL,
  logic_version text NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, cohort, field)
);
ALTER TABLE public.field_coverage_snapshots ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.field_coverage_snapshots IS
  'Per-field coverage counts per cohort (20261124020000, field_coverage_snapshot_v1). Counts only; no vehicle text is stored.';

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


CREATE OR REPLACE FUNCTION public.data_set_candidates_v1(p_vehicles uuid[])
 RETURNS TABLE(set_kind text, set_key text, set_label text, set_provenance jsonb, member_type text, member_id uuid, vehicle_id uuid, basis_type text, basis_id uuid, basis_detail jsonb, confidence numeric, member_rule_version text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH v AS (
    SELECT x.id, upper(btrim(x.vin)) AS vin, x.year, lower(btrim(x.make)) AS mk, x.is_replica, x.replica_quote
      FROM public.vehicles x
     WHERE x.id = ANY (p_vehicles) AND x.deleted_at IS NULL AND x.merged_into_vehicle_id IS NULL
       AND x.status IS DISTINCT FROM 'merged'),
  -- Pontiac Firebird VIN formats (vehicle_decode_rules cite the chart for each position):
  --   gm_1970_1971_car_vin_v1: 2 + series (2 digits, e.g. 28 = Trans Am) + body (2) + year digit (0/1) + plant + serial (6); no engine
  --   gm_1972_1980_car_vin_v1: 2 + series + body (2) + engine + year (2-9, A = 1980) + plant + serial (6)
  --   gm_1981_17_vin_v1: 1G2 + restraint + series + body (2) + engine + check + B (1981) + plant + serial (6)
  vin AS (
    SELECT v.*, substr(v.vin, 2, 1) AS series, substr(v.vin, 3, 2) AS body, substr(v.vin, 5, 1) AS eng,
           substr(v.vin, 7, 1) AS plant,
           CASE substr(v.vin, 6, 1) WHEN 'A' THEN 1980 ELSE 1970 + substr(v.vin, 6, 1)::int END AS dyear,
           'gm_1972_1980_car_vin_v1'::text AS fmt
      FROM v WHERE v.mk = 'pontiac' AND v.vin ~ '^2[A-Z][0-9]{2}[A-Z][2-9A][A-Z][0-9]{6}$'
    UNION ALL
    SELECT v.*, substr(v.vin, 2, 2), substr(v.vin, 4, 2), NULL::text, substr(v.vin, 7, 1),
           1970 + substr(v.vin, 6, 1)::int, 'gm_1970_1971_car_vin_v1'
      FROM v WHERE v.mk = 'pontiac' AND v.vin ~ '^22[3468]87[01][A-Z][0-9]{6}$'
    UNION ALL
    SELECT v.*, substr(v.vin, 5, 1), substr(v.vin, 6, 2), substr(v.vin, 8, 1), substr(v.vin, 11, 1),
           1981, 'gm_1981_17_vin_v1'
      FROM v WHERE v.mk = 'pontiac' AND v.vin ~ '^1G2[A-C][A-Z]87[A-Z][0-9X]B[A-Z][0-9]{6}$'),
  vin_ok AS (SELECT * FROM vin WHERE vin.year IS NULL OR vin.year = vin.dyear),
  vin_basis AS (
    SELECT o.*, fe.id AS fe_id, fe.source_confidence,
           -- a model-scoped VIN character rule applies only when the VIN's body code is one that model's rule lists
           EXISTS (SELECT 1 FROM public.vehicle_decode_rules b WHERE b.rule_key = 'vin_body_code' AND b.superseded_at IS NULL
                    AND lower(b.make) = o.mk AND b.code = o.body
                    AND (b.year_min IS NULL OR b.year_min <= o.dyear) AND (b.year_max IS NULL OR b.year_max >= o.dyear)) AS body_ruled
      FROM vin_ok o
      LEFT JOIN LATERAL (
        SELECT f.id, f.source_confidence FROM public.field_evidence f
         WHERE f.vehicle_id = o.id AND f.source_type = 'gm_vin_chart' AND f.field_name = 'vin'
           AND upper(btrim(f.proposed_value)) = o.vin AND coalesce(f.status, '') NOT IN ('rejected','superseded')
         ORDER BY f.source_confidence DESC NULLS LAST, f.id LIMIT 1) fe ON true),
  vin_rows AS (
    SELECT b.*, k.kind, k.skey, k.lbl
      FROM vin_basis b
     CROSS JOIN LATERAL (VALUES
       ('vin_cohort', format('%s:%s:%s%s:%s', b.mk, b.dyear, b.series, b.body, b.eng),
          CASE WHEN b.body_ruled THEN jsonb_build_object('series', public.data_set_rule_label('vin_series_char', b.mk, b.series, b.dyear),
                                                         'engine', public.data_set_rule_label('vin_engine_char', b.mk, b.eng, b.dyear)) END),
       ('vin_series', format('%s:%s:%s%s', b.mk, b.dyear, b.series, b.body),
          CASE WHEN b.body_ruled THEN public.data_set_rule_label('vin_series_char', b.mk, b.series, b.dyear) END),
       ('vin_engine', format('%s:%s:%s', b.mk, b.dyear, b.eng),
          CASE WHEN b.body_ruled THEN public.data_set_rule_label('vin_engine_char', b.mk, b.eng, b.dyear) END),
       ('plant_year', format('%s:%s:%s', b.mk, b.dyear, b.plant),
          CASE WHEN b.body_ruled THEN public.data_set_rule_label('vin_plant_char', b.mk, b.plant, b.dyear) END)
     ) k(kind, skey, lbl)
     WHERE b.eng IS NOT NULL OR k.kind IN ('vin_series','plant_year')),
  vin_out AS (
    SELECT r.kind, lower(r.skey),
           CASE WHEN r.kind = 'vin_cohort' THEN
                  CASE WHEN r.lbl->'series'->>'label' IS NOT NULL AND r.lbl->'engine'->>'label' IS NOT NULL
                       THEN (r.lbl->'series'->>'label') || '; ' || (r.lbl->'engine'->>'label') END
                ELSE r.lbl->>'label' END,
           jsonb_build_object('decode_rule', r.fmt, 'rules', coalesce(r.lbl, '{}'::jsonb)),
           'vehicle'::text, r.id, r.id,
           CASE WHEN r.fe_id IS NOT NULL THEN 'field_evidence' ELSE 'vehicle_vin' END,
           coalesce(r.fe_id, r.id),
           jsonb_build_object('vin', r.vin, 'positions', jsonb_build_object('series', r.series, 'body', r.body,
             'engine', r.eng, 'year', r.dyear, 'plant', r.plant)),
           CASE WHEN r.fe_id IS NOT NULL THEN least(greatest(coalesce(r.source_confidence, 90), 1), 100) / 100.0 ELSE 0.80 END,
           r.fmt
      FROM vin_rows r),
  -- Photo decode observations (one reviewer's reading of one photo each).
  obs AS (
    SELECT o.id, o.vehicle_id, o.extraction_method AS m, o.structured_data AS sd,
           least(greatest(coalesce(o.confidence_score, 0.5), 0.01), 1) AS conf, v.year, v.mk,
           CASE WHEN o.structured_data->>'tag_model_year' ~ '^[0-9]{2}$' THEN 1900 + (o.structured_data->>'tag_model_year')::int
                ELSE v.year END AS tyear
      FROM public.vehicle_observations o JOIN v ON v.id = o.vehicle_id
     WHERE o.extraction_method IN ('cowl_tag_decode_v1','engine_block_decode_v1','trans_id_stamp_decode_v1')
       AND NOT coalesce(o.is_superseded, false)),
  obs_codes AS (
    SELECT o.*, e.kind, upper(btrim(e.code)) AS code, e.rule_key
      FROM obs o
     CROSS JOIN LATERAL (VALUES
       ('engine_block_casting', CASE WHEN o.m = 'engine_block_decode_v1' THEN o.sd->>'engine_block_casting' END, 'block_casting'),
       ('engine_code', CASE WHEN o.m = 'engine_block_decode_v1' THEN coalesce(o.sd->>'engine_code_stamp', o.sd->>'engine_code') END, 'engine_stamp_code'),
       ('trans_case_casting', CASE WHEN o.m = 'trans_id_stamp_decode_v1' THEN coalesce(o.sd->>'transmission_case_casting', o.sd->>'case_casting') END, 'transmission_case_casting'),
       ('trans_tail_casting', CASE WHEN o.m = 'trans_id_stamp_decode_v1' THEN coalesce(o.sd->>'transmission_tailhousing_casting', o.sd->>'transmission_tailhousing') END, 'transmission_tailhousing_casting'),
       ('paint_code', CASE WHEN o.m = 'cowl_tag_decode_v1' THEN coalesce(o.sd->>'paint_code', o.sd->'body_tag_paint_code'->>'lower') END, 'body_tag_paint_code'),
       ('cowl_style', CASE WHEN o.m = 'cowl_tag_decode_v1' THEN coalesce(o.sd->>'fisher_style_number', o.sd->>'body_tag_style') END, 'body_tag_style_number'),
       ('plant_year', CASE WHEN o.m = 'cowl_tag_decode_v1' THEN o.sd->>'assembly_plant_code' END, 'body_tag_plant_code')
     ) e(kind, code, rule_key)
     WHERE e.code IS NOT NULL AND btrim(e.code) ~ '^[A-Za-z0-9]{1,12}$' AND o.mk IS NOT NULL
       AND (e.kind NOT IN ('paint_code','cowl_style','plant_year') OR o.tyear IS NOT NULL)
       AND (e.kind <> 'plant_year' OR btrim(e.code) ~ '^[A-Za-z]$')),
  obs_keyed AS (
    SELECT c.*, lower(CASE c.kind
             WHEN 'engine_code' THEN format('%s:%s', c.mk, c.code)
             WHEN 'paint_code' THEN format('%s:%s:%s', c.mk, c.tyear, c.code)
             WHEN 'cowl_style' THEN format('%s:%s', c.tyear, c.code)
             WHEN 'plant_year' THEN format('%s:%s:%s', c.mk, c.tyear, c.code)
             ELSE c.code END) AS skey,
           public.data_set_rule_label(CASE WHEN c.kind = 'plant_year' THEN 'vin_plant_char' ELSE c.rule_key END, c.mk, c.code,
             CASE WHEN c.kind IN ('paint_code','cowl_style','plant_year') THEN c.tyear END) AS lbl,
           CASE WHEN c.sd->>'image_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 AND EXISTS (SELECT 1 FROM public.vehicle_images vi WHERE vi.id = (c.sd->>'image_id')::uuid AND vi.vehicle_id = c.vehicle_id)
                THEN (c.sd->>'image_id')::uuid END AS image_id
      FROM obs_codes c),
  obs_out AS (
    SELECT k.kind, k.skey, k.lbl->>'label', jsonb_build_object('decode_rule', k.m, 'rules', k.lbl),
           mt.member_type, mt.member_id, k.vehicle_id, 'observation'::text, k.id,
           jsonb_build_object('claim_role', k.sd->>'claim_role', 'code', k.code), k.conf, k.m
      FROM obs_keyed k
     CROSS JOIN LATERAL (VALUES ('vehicle', k.vehicle_id), ('image', k.image_id)) mt(member_type, member_id)
     WHERE mt.member_id IS NOT NULL),
  -- Text code readings (vehicle_code_readings, text_code_decode_v1 / v2): keyed by data_set_code_key_v1, one cited read each.
  crd_out AS (SELECT * FROM public.data_set_code_candidates_v1((SELECT array_agg(v.id) FROM v), NULL)),
  -- Replicas (vehicles.is_replica): as built = the VIN cohort; as presented = replica_presented_v1 read of replica_quote,
  -- resolved to VIN codes through the decode rules for that year (no rule, no as-presented membership).
  rep AS (
    SELECT b.*,
           (public.data_set_replica_presented_v1(b.replica_quote)).p_series,
           (public.data_set_replica_presented_v1(b.replica_quote)).p_app
      FROM vin_basis b WHERE b.is_replica IS TRUE AND b.eng IS NOT NULL),
  rep_codes AS (
    SELECT r.*,
           (SELECT d.code FROM public.vehicle_decode_rules d WHERE d.rule_key = 'vin_series_char' AND d.superseded_at IS NULL
             AND lower(d.make) = r.mk AND d.value->>'series' = r.p_series AND d.year_min <= r.dyear AND d.year_max >= r.dyear
             ORDER BY d.id LIMIT 1) AS ps,
           (SELECT d.code FROM public.vehicle_decode_rules d WHERE d.rule_key = 'vin_engine_char' AND d.superseded_at IS NULL
             AND lower(d.make) = r.mk AND d.value->>'application' = r.p_app AND d.year_min <= r.dyear AND d.year_max >= r.dyear
             ORDER BY d.id LIMIT 1) AS pe
      FROM rep r),
  rep_out AS (
    SELECT 'replica_cohort'::text, lower(format('as_built:%s:%s:%s%s:%s', r.mk, r.dyear, r.series, r.body, r.eng)),
           NULL::text, jsonb_build_object('rule', 'replica_cohort_v1', 'cohort', 'as_built'),
           'vehicle'::text, r.id, r.id, 'vehicle_flag'::text, r.id,
           jsonb_build_object('is_replica', true, 'cohort', 'as_built', 'vin', r.vin), 0.80::numeric, 'replica_cohort_v1'::text
      FROM rep_codes r
    UNION ALL
    SELECT 'replica_cohort', lower(CASE WHEN r.pe IS NOT NULL THEN format('as_presented:%s:%s:%s%s:%s', r.mk, r.dyear, r.ps, r.body, r.pe)
                                        ELSE format('as_presented:%s:%s:%s%s', r.mk, r.dyear, r.ps, r.body) END),
           concat_ws(' ', r.p_series, r.p_app), jsonb_build_object('rule', 'replica_presented_v1', 'cohort', 'as_presented'),
           'vehicle', r.id, r.id, 'vehicle_flag', r.id,
           jsonb_build_object('is_replica', true, 'cohort', 'as_presented', 'presented_series', r.p_series,
                              'presented_engine', r.p_app, 'read_from', 'vehicles.replica_quote', 'vin', r.vin),
           0.50, 'replica_presented_v1'
      FROM rep_codes r WHERE r.ps IS NOT NULL),
  com_out AS (
    SELECT 'comment_theme'::text, t.theme, NULL::text, jsonb_build_object('rubric', 'comment_theme_v1'),
           'auction_comment'::text, c.id, c.vehicle_id, 'comment_rubric'::text, c.id,
           jsonb_build_object('matched', t.matched, 'auction_event_id', c.auction_event_id), 0.50::numeric, 'comment_theme_v1'::text
      FROM public.auction_comments c
      JOIN v ON v.id = c.vehicle_id
     CROSS JOIN LATERAL public.data_set_comment_themes_v1(c.comment_text) t
     WHERE c.comment_type IS DISTINCT FROM 'bid' AND c.comment_type IS DISTINCT FROM 'sold')
  SELECT * FROM vin_out
  UNION ALL SELECT * FROM obs_out
  UNION ALL SELECT * FROM rep_out
  UNION ALL SELECT * FROM com_out
  UNION ALL SELECT * FROM crd_out
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_data_sets(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '8s'
AS $function$
DECLARE v_out jsonb;
BEGIN
  IF p_vehicle_id IS NULL OR NOT public.data_set_can_read_vehicle(p_vehicle_id) THEN
    RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'error', 'not_found_or_not_public');
  END IF;
  WITH mine AS (
    SELECT m.set_id, max(m.confidence) AS conf,
           count(*) FILTER (WHERE m.member_type = 'vehicle') AS n_vehicle_bases,
           count(*) FILTER (WHERE m.member_type = 'image') AS n_images,
           count(*) FILTER (WHERE m.member_type = 'auction_comment') AS n_comments,
           jsonb_agg(DISTINCT jsonb_build_object('basis_type', m.basis_type, 'basis_id', m.basis_id, 'rule', m.rule_version,
                                                 'confidence', m.confidence))
             FILTER (WHERE m.member_type = 'vehicle') AS bases
      FROM public.data_set_members m
     WHERE m.vehicle_id = p_vehicle_id AND m.state = 'active'
     GROUP BY m.set_id),
  sets AS (
    SELECT s.id, s.set_kind, s.set_key, s.label, s.rule_version, mine.*,
           (SELECT count(DISTINCT m2.vehicle_id) FROM public.data_set_members m2
              JOIN public.vehicles pv ON pv.id = m2.vehicle_id AND pv.is_public IS TRUE AND pv.deleted_at IS NULL
             WHERE m2.set_id = s.id AND m2.state = 'active' AND m2.member_type IN ('vehicle','auction_comment')) AS n_vehicles
      FROM mine JOIN public.data_sets s ON s.id = mine.set_id)
  SELECT jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'logic_version', 'data_set_membership/20261123180000.1',
    'sets', coalesce(jsonb_agg(jsonb_build_object(
        'set_id', sets.id, 'set_kind', sets.set_kind, 'set_key', sets.set_key, 'label', sets.label,
        'confidence', sets.conf, 'public_vehicles_in_set', sets.n_vehicles,
        'evidence', jsonb_build_object('vehicle_bases', coalesce(sets.bases, '[]'::jsonb), 'images', sets.n_images,
                                       'comments', sets.n_comments))
        ORDER BY sets.set_kind, sets.set_key), '[]'::jsonb),
    'unknown_kinds', (SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) FROM unnest(ARRAY['vin_cohort','vin_series','vin_engine',
        'plant_year','cowl_style','engine_block_casting','engine_code','trans_case_casting','trans_tail_casting','paint_code',
        'replica_cohort','comment_theme','cowl_option','body_style','trim_level','engine_cid','trans_type','trans_speeds',
        'trans_model','axle_ratio','interior_trim_code','rpo_code','build_month','dealer_zone','documentation']) k WHERE NOT EXISTS (SELECT 1 FROM sets WHERE sets.set_kind = k)))
    INTO v_out FROM sets;
  RETURN v_out;
END
$function$;

-- Latent mentions in sources the producer does not key (photo text, photo descriptions) and listing-only fields stated in
-- comments: counts of vehicles per source and field over a deterministic sample of a scope. Read only; returns counts.
CREATE OR REPLACE FUNCTION public.field_latent_sources_v1(p_scope text, p_limit integer DEFAULT 400)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '600s'
AS $function$
DECLARE v_ids uuid[]; v_out jsonb;
BEGIN
  SELECT array_agg(x ORDER BY md5(x::text)) INTO v_ids
    FROM (SELECT x FROM unnest(coalesce(public.data_set_scope_vehicles(p_scope, NULL), '{}')) x ORDER BY md5(x::text) LIMIT p_limit) z;
  v_ids := coalesce(v_ids, '{}');
  WITH veh AS (SELECT x.id, x.make, x.model FROM public.vehicles x WHERE x.id = ANY (v_ids)),
  src AS (
    SELECT 'photo_text_lines'::text AS source, x.id, x.make, x.model, p.text AS txt
      FROM veh x JOIN public.photo_text_lines p ON p.vehicle_id = x.id
    UNION ALL
    SELECT 'image_descriptions', x.id, x.make, x.model, d.description
      FROM veh x JOIN public.image_descriptions d ON d.vehicle_id = x.id
    UNION ALL
    SELECT 'auction_comments', x.id, x.make, x.model, ac.comment_text
      FROM veh x JOIN public.auction_comments ac ON ac.vehicle_id = x.id
     WHERE ac.comment_type IS DISTINCT FROM 'bid' AND ac.comment_type IS DISTINCT FROM 'sold'),
  hits AS (
    SELECT DISTINCT s.source, s.id, t.kind
      FROM src s CROSS JOIN LATERAL public.text_spec_matches_v2(s.txt, 'listing', s.make, s.model) t
     WHERE s.txt IS NOT NULL),
  per AS (SELECT h.source, h.kind, count(DISTINCT h.id) AS n FROM hits h GROUP BY 1, 2),
  cov AS (SELECT s.source, count(DISTINCT s.id) AS n FROM src s GROUP BY 1)
  SELECT jsonb_build_object('scope', p_scope, 'sampled_vehicles', cardinality(v_ids),
           'method', 'first N vehicles of the scope by md5(id); text_spec_matches_v2 with listing rules on every source',
           'vehicles_with_source', (SELECT coalesce(jsonb_object_agg(source, n), '{}'::jsonb) FROM cov),
           'vehicles_with_mention', (SELECT coalesce(jsonb_object_agg(source, kinds), '{}'::jsonb) FROM
              (SELECT source, jsonb_object_agg(kind, n) AS kinds FROM per GROUP BY source) z))
    INTO v_out;
  RETURN v_out;
END
$function$;

REVOKE ALL ON FUNCTION public.text_spec_matches_v2(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.text_rpo_known_v1(text, text, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.text_code_decode_v2(uuid, text, uuid, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.data_set_code_key_v1(text, text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.data_set_code_candidates_v1(uuid[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.data_set_membership_plan_v2(uuid, text, uuid, text[], integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.field_coverage_snapshot_v1(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.field_latent_sources_v1(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.text_spec_matches_v2(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.text_rpo_known_v1(text, text, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.text_code_decode_v2(uuid, text, uuid, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.data_set_code_key_v1(text, text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.data_set_code_candidates_v1(uuid[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.data_set_membership_plan_v2(uuid, text, uuid, text[], integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.field_coverage_snapshot_v1(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.field_latent_sources_v1(text, integer) TO service_role;

commit;
