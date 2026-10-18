-- Deep Emblem Registry Expansion + Full-Title/Trim/Body Facet Enrichment in `treemap_family_sales`
-- (2026-10-18)
--
-- 1. Updates `public.treemap_family_sales` so element [5] (`model` descriptor) appends non-redundant tokens from
--    `vehicles.trim`, `vehicles.body_style`, and `COALESCE(vehicles.listing_title, vehicles.title)` while keeping
--    the exact 6-element JSON array contract `[vehicle_id, sale_date, usd, source, year, model]`.
--    This allows the frontend multi-axis classifier (`SERIES` | `TRIM` | `BODY STYLE`) to extract `Silverado`,
--    `Cheyenne Super`, `Scottsdale`, `Custom Deluxe`, `Sierra Grande`, `High Sierra`, `Sierra Classic`, `Fastback`,
--    `Convertible`, `2-Door Hardtop`, `4-Door Sedan`, `Stepside`, `Fleetside`, `Targa`, `Cabriolet`, `Z/28`, `SS`, `RS`,
--    and `IROC-Z` even when the raw `vehicles.model` column only says `C10`, `Pickup`, `Mustang`, or `Bel Air`.
-- 2. Seeds 28 additional factory-vetted period identity marks into `public.vehicle_identity_marks`:
--    - Chevrolet Squarebody: `CUSTOM DELUXE 20`, `SCOTTSDALE 20`, `CHEYENNE 20`, `CHEYENNE SUPER 20`, `BIG 10` ('75-'80), `454 SS` ('90-'93)
--    - Chevrolet Action Line ('67-'72): `CST / CUSTOM SPORT TRUCK 10`, `CHEYENNE 10` ('71-'72)
--    - Chevrolet Advance Design ('47-'55) & Task Force ('55-'59): `3100 THRIFTMASTER`, `APACHE 31`, `CAMEO CARRIER`
--    - GMC Squarebody ('73-'87): `CUSTOM 15` ('73-'74), `SUPER CUSTOM 15` ('73-'74), `SIERRA CLASSIC 1500` ('75-'87), `SYCLONE` ('91)
--    - Chevrolet Tri-Five Bel Air ('55-'57): `BEL AIR GOLD SCRIPT`, `NOMAD SPORT WAGON`, `2-DOOR HARDTOP SPORT COUPE`, `4-DOOR SEDAN`
--    - Chevrolet Chevelle ('64-'72) & Camaro ('67-'92): `SS 396`, `SS 454`, `CAMARO Z/28`, `CAMARO RS`, `IROC-Z`
--    - Ford Mustang ('65-'73) & Bronco ('66-'77): `MACH 1`, `BOSS 302`, `BOSS 429`, `SHELBY GT350`, `SHELBY GT500`, `BRONCO SPORT`
--    - Porsche 911: `911 TARGA`, `911 TURBO (930)`, `CARRERA RS 2.7`

BEGIN;

CREATE OR REPLACE FUNCTION public.treemap_family_sales(p_brand text, p_family_key text, p_limit integer DEFAULT 12000)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH target_keys AS (
    SELECT p_family_key AS family_key
    UNION
    SELECT DISTINCT m.family_key
    FROM public.mv_family_market m
    WHERE m.brand = p_brand
      AND EXISTS (
        SELECT 1
        FROM public.mv_family_market u
        WHERE u.brand = p_brand
          AND u.family_key = p_family_key
          AND u.family = 'Pickup'
      )
      AND (
        (p_brand = 'Chevrolet' AND m.family IN (
          'Pickup', '3100', '3600', '3800', 'Apache', 'Cameo',
          'C10', 'K10', 'C20', 'K20', 'C30', 'K30',
          'C1500', 'K1500', '454 SS', 'C2500', 'K2500', 'C3500', 'K3500', '3500',
          'S10', 'S-10 Pickup', 'Silverado'
        ))
        OR (p_brand = 'GMC' AND m.family IN (
          'Pickup', 'C1500', 'K1500', 'Sierra', 'Syclone',
          'Sonoma', 'S15 Pickup', 'Caballero', 'C2500', 'K2500', 'C3500', 'K3500'
        ))
        OR (p_brand = 'Ford' AND m.family IN (
          'Pickup', 'F-1', 'F-100', 'F-150', 'F-250', 'F-350', 'F-450', 'Ranger'
        ))
      )
  ),
  raw_w AS (
    SELECT s.vehicle_id, s.sale_date, s.usd, s.source, s.year, s.model
    FROM public.mv_family_sales s
    JOIN target_keys tk ON tk.family_key = s.family_key
    WHERE s.brand = p_brand
      AND s.sale_date > current_date - 1826
      AND s.sale_date <= current_date
    UNION
    SELECT s.vehicle_id, s.sale_date, s.usd, s.source, s.year, s.model
    FROM public.mv_family_sales s
    WHERE s.brand = p_brand
      AND s.sale_date > current_date - 1826
      AND s.sale_date <= current_date
      AND (
        (
          p_brand = 'Chevrolet'
          AND EXISTS (
            SELECT 1 FROM public.mv_family_market u
            WHERE u.brand = p_brand AND u.family_key = p_family_key AND u.family = 'Silverado'
          )
          AND s.model ILIKE '%silverado%'
        )
        OR (
          p_brand = 'GMC'
          AND EXISTS (
            SELECT 1 FROM public.mv_family_market u
            WHERE u.brand = p_brand AND u.family_key = p_family_key AND u.family = 'Sierra'
          )
          AND s.model ILIKE '%sierra%'
        )
      )
  ),
  step1 AS (
    SELECT DISTINCT ON (
      s.usd,
      s.source,
      COALESCE(s.year, 0),
      CASE
        WHEN s.source = 'Barrett-Jackson'
          AND v.primary_image_url IS NOT NULL
          AND btrim(v.primary_image_url) <> ''
        THEN 'bj-img:' || lower(regexp_replace(btrim(v.primary_image_url), '\?.*$', ''))
        WHEN s.source IN ('Bring a Trailer', 'Mecum', 'Bonhams')
          OR to_char(s.sale_date, 'MM-DD') <> '01-01'
        THEN 'dt:' || s.sale_date::text
        ELSE 'id:' || s.vehicle_id::text
      END
    )
      s.vehicle_id,
      s.sale_date,
      s.usd,
      s.source,
      s.year,
      -- Enrich model string with trim / body_style / listing_title when raw model lacks trim/body tokens
      btrim(
        COALESCE(NULLIF(btrim(s.model), ''), NULLIF(btrim(v.model), ''), '')
        || CASE
             WHEN v.trim IS NOT NULL AND btrim(v.trim) <> ''
                  AND position(lower(btrim(v.trim)) in lower(COALESCE(s.model, ''))) = 0
             THEN ' ' || btrim(v.trim)
             ELSE ''
           END
        || CASE
             WHEN v.body_style IS NOT NULL AND btrim(v.body_style) <> ''
                  AND lower(btrim(v.body_style)) NOT IN ('truck', 'pickup', 'car', 'cars', 'other', 'subcompact cars', 'compact cars')
                  AND position(lower(btrim(v.body_style)) in lower(COALESCE(s.model, '') || ' ' || COALESCE(v.trim, ''))) = 0
             THEN ' ' || btrim(v.body_style)
             ELSE ''
           END
        || CASE
             WHEN COALESCE(v.listing_title, v.title) IS NOT NULL
                  AND length(COALESCE(s.model, '')) <= 18
             THEN ' · ' || btrim(COALESCE(v.listing_title, v.title))
             ELSE ''
           END
      ) AS model,
      v.vin,
      v.primary_image_url
    FROM raw_w s
    LEFT JOIN public.vehicles v ON v.id = s.vehicle_id
    ORDER BY
      s.usd DESC,
      s.source,
      COALESCE(s.year, 0),
      CASE
        WHEN s.source = 'Barrett-Jackson'
          AND v.primary_image_url IS NOT NULL
          AND btrim(v.primary_image_url) <> ''
        THEN 'bj-img:' || lower(regexp_replace(btrim(v.primary_image_url), '\?.*$', ''))
        WHEN s.source IN ('Bring a Trailer', 'Mecum', 'Bonhams')
          OR to_char(s.sale_date, 'MM-DD') <> '01-01'
        THEN 'dt:' || s.sale_date::text
        ELSE 'id:' || s.vehicle_id::text
      END,
      (to_char(s.sale_date, 'MM-DD') <> '01-01') DESC,
      (v.primary_image_url IS NOT NULL AND btrim(v.primary_image_url) <> '') DESC,
      (v.vin IS NOT NULL AND btrim(v.vin) <> '') DESC,
      s.sale_date DESC,
      length(COALESCE(s.model, '')) DESC,
      s.vehicle_id
  ),
  w AS (
    SELECT a.vehicle_id, a.sale_date, a.usd, a.source, a.year, a.model
    FROM step1 a
    WHERE NOT (
      a.source = 'Mecum'
      AND (a.vin IS NULL OR btrim(a.vin) = '')
      AND (a.primary_image_url IS NULL OR btrim(a.primary_image_url) = '')
      AND EXISTS (
        SELECT 1
        FROM step1 b
        WHERE b.vehicle_id <> a.vehicle_id
          AND b.source = a.source
          AND b.usd = a.usd
          AND COALESCE(b.year, 0) = COALESCE(a.year, 0)
          AND abs(b.sale_date - a.sale_date) <= 3
          AND (
            (b.vin IS NOT NULL AND btrim(b.vin) <> '')
            OR (b.primary_image_url IS NOT NULL AND btrim(b.primary_image_url) <> '')
            OR b.sale_date > a.sale_date
            OR (b.sale_date = a.sale_date AND b.vehicle_id < a.vehicle_id)
          )
      )
    )
  ),
  page AS (
    SELECT * FROM w ORDER BY sale_date DESC, vehicle_id LIMIT least(greatest(p_limit, 1), 12000)
  )
  SELECT jsonb_build_object(
    'n', (SELECT count(*) FROM w),
    'returned', (SELECT count(*) FROM page),
    'truncated', (SELECT count(*) FROM w) > (SELECT count(*) FROM page),
    'window_from', current_date - 1825,
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_array(vehicle_id, sale_date, usd, source, year, model)
                       ORDER BY sale_date DESC, vehicle_id)
      FROM page
    ), '[]'::jsonb)
  );
$function$;

INSERT INTO public.vehicle_identity_marks (
  brand, family, series_code, trim_package, body_style, year_start, year_end,
  mark_kind, display_label, sub_label, rpo_code, fender_placement,
  typography_style, border_treatment, primary_color, secondary_color, accent_color,
  svg_markup, provenance_note
) VALUES
  -- Chevrolet Advance Design & Task Force & Action Line
  (
    'Chevrolet', 'Pickup', '3100', 'Thriftmaster', NULL, 1947, 1955,
    'series_badge', 'CHEVROLET 3100', '1947–1955 Advance Design Chrome Hood Side Emblem', NULL, 'Hood Side',
    'vintage_serif', 'chrome_bezel', '#1b365d', '#f5f5f0', '#dc2626',
    '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><polygon points="6,10 184,10 174,32 16,32" fill="#1b365d" stroke="#e5e7eb" stroke-width="2.2"/><text x="95" y="25" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-size="13.5" font-weight="800" letter-spacing="2.5">CHEVROLET 3100</text></svg>',
    '1947–1955 Advance Design 1/2-ton 3100 hood side badge.'
  ),
  (
    'Chevrolet', 'Pickup', 'Apache', NULL, NULL, 1958, 1961,
    'series_badge', 'APACHE 10 / 31', '1958–1961 Task Force & Early C/K Apache Fender Crest', NULL, 'Front Fender',
    'western_slab', 'chrome_bezel', '#18181b', '#facc15', '#dc2626',
    '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><polygon points="10,6 180,6 170,34 20,34" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><text x="95" y="25" text-anchor="middle" fill="#facc15" font-family="Georgia,serif" font-size="14" font-weight="800" letter-spacing="2.8">APACHE</text></svg>',
    '1958–1961 Chevrolet Apache light-duty pickup fender crest.'
  ),
  (
    'Chevrolet', 'Pickup', 'Cameo', NULL, 'Fleetside', 1955, 1958,
    'series_badge', 'CAMEO CARRIER', '1955–1958 Task Force Fiberglass Styled Pickup Script', 'Model 3124', 'Front Fender & Fiberglass Bedside',
    'cursive_script', 'chrome_script', '#b91c1c', '#f9fafb', '#e5e7eb',
    '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="6" width="182" height="28" rx="3" fill="#7f1d1d" stroke="#e5e7eb" stroke-width="2"/><text x="95" y="25" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-style="italic" font-size="14" font-weight="700" letter-spacing="1.5">Cameo Carrier</text></svg>',
    '1955–1958 Chevrolet 3124 Cameo Carrier luxury fiberglass-bedside script.'
  ),
  (
    'Chevrolet', 'Pickup', 'C10', 'CST', NULL, 1967, 1972,
    'trim_badge', 'CST / 10', '1967–1972 Action Line Custom Sport Truck Fender Plate', 'RPO Z84', 'Lower Front Fender',
    'square_block', 'chrome_bezel', '#111827', '#facc15', '#dc2626',
    '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#111827" stroke="#e5e7eb" stroke-width="2.2"/><rect x="132" y="8" width="52" height="24" fill="#991b1b"/><text x="67" y="25" text-anchor="middle" fill="#facc15" font-family="Georgia,serif" font-size="14" font-weight="800" letter-spacing="3">C S T</text><text x="158" y="26" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="16" font-weight="900">10</text></svg>',
    '1967–1972 Action Line C10/K10 CST (Custom Sport Truck) lower fender badge.'
  ),
  (
    'Chevrolet', 'Pickup', 'C10', 'Big 10', NULL, 1975, 1980,
    'trim_badge', 'BIG 10', '1975–1980 Heavy-Duty Half-Ton F44 Decal & Fender Callout', 'RPO F44', 'Upper Bedside & Tailgate',
    'heavy_slab', 'decal_stripe', '#18181b', '#f97316', '#facc15',
    '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#18181b" stroke="#f97316" stroke-width="2.5"/><text x="95" y="27" text-anchor="middle" fill="#facc15" font-family="Arial Black,Impact,sans-serif" font-size="18" font-weight="900" letter-spacing="3.5">BIG 10</text></svg>',
    '1975–1980 Chevrolet C10 RPO F44 heavy-duty half-ton "BIG 10" bedside callout.'
  ),
  (
    'Chevrolet', 'Pickup', 'C1500', '454 SS', NULL, 1990, 1993,
    'trim_badge', '454 SS', '1990–1993 GMT400 Muscle Truck Bedside Decal', 'RPO B4U', 'Rear Bedside',
    'heavy_slab', 'flush_bezel', '#111111', '#dc2626', '#f3f4f6',
    '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#09090b" stroke="#dc2626" stroke-width="2.2"/><text x="95" y="27" text-anchor="middle" fill="#ef4444" font-family="Arial Black,Impact,sans-serif" font-size="18" font-weight="900" letter-spacing="3">454 SS</text></svg>',
    '1990–1993 Chevrolet C1500 454 SS (RPO B4U) big-block sport pickup badge.'
  ),

  -- GMC Squarebody 1973–1974 Early vs 1975–1987 Sierra Classic & Syclone
  (
    'GMC', 'Pickup', 'C1500', 'Custom', NULL, 1973, 1974,
    'trim_badge', 'CUSTOM 15', '1973–1974 Early Squarebody Base Two-Digit Fender Plate', NULL, 'Front Fender (1973–1974)',
    'square_block', 'chrome_bezel', '#18181b', '#e5e7eb', '#dc2626',
    '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><rect x="140" y="8" width="44" height="24" fill="#dc2626"/><text x="70" y="25" text-anchor="middle" fill="#f3f4f6" font-family="Arial,sans-serif" font-size="12.5" font-weight="800" letter-spacing="2.2">CUSTOM</text><text x="162" y="26" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="16" font-weight="900">15</text></svg>',
    '1973–1974 GMC Custom 15 base trim two-digit fender plate.'
  ),
  (
    'GMC', 'Pickup', 'C1500', 'Super Custom', NULL, 1973, 1974,
    'trim_badge', 'SUPER CUSTOM 15', '1973–1974 GMC Super Custom Two-Digit Fender Plate', NULL, 'Front Fender (1973–1974 only)',
    'square_block', 'chrome_bezel', '#18181b', '#facc15', '#dc2626',
    '<svg viewBox="0 0 205 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="3" width="201" height="34" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><rect x="152" y="6" width="47" height="28" fill="#dc2626"/><text x="76" y="17" text-anchor="middle" fill="#facc15" font-family="Arial,sans-serif" font-size="9.5" font-weight="800" letter-spacing="2.5">SUPER</text><text x="76" y="30" text-anchor="middle" fill="#f3f4f6" font-family="Arial,sans-serif" font-size="11" font-weight="800" letter-spacing="2">CUSTOM</text><text x="175" y="26" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="16" font-weight="900">15</text></svg>',
    '1973–1974 GMC Super Custom 15 fender badge before GMC reorganized trims in 1975.'
  ),
  (
    'GMC', 'Pickup', 'C1500', 'Sierra Classic', NULL, 1975, 1987,
    'trim_badge', 'SIERRA CLASSIC 1500', '1975–1987 GMC Top-Tier Luxury Trim Plate (Silverado Equivalent)', 'RPO YE9', 'Front Fender',
    'cursive_script', 'chrome_bezel', '#18181b', '#facc15', '#dc2626',
    '<svg viewBox="0 0 215 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="3" width="211" height="34" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><rect x="148" y="6" width="61" height="28" fill="#991b1b"/><text x="75" y="17" text-anchor="middle" fill="#f3f4f6" font-family="Arial,sans-serif" font-size="10.5" font-weight="800" letter-spacing="2.2">SIERRA</text><text x="75" y="30" text-anchor="middle" fill="#facc15" font-family="Georgia,serif" font-style="italic" font-size="11.5" font-weight="700" letter-spacing="1.2">Classic</text><text x="178" y="25" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="14.5" font-weight="900">1500</text></svg>',
    '1975–1987 GMC Sierra Classic 1500 top-of-the-line fender badge (counterpart to Chevrolet Silverado).'
  ),

  -- Chevrolet Bel Air / Tri-Five (1955–1957) & 2-Door vs 4-Door vs Nomad
  (
    'Chevrolet', 'Bel Air', NULL, NULL, NULL, 1955, 1957,
    'model_wordmark', 'BEL AIR', '1955–1957 Tri-Five Gold Anodized Quarter-Panel Script & Crest', NULL, 'Rear Quarter Panel & Hood V-Crest',
    'cursive_script', 'gold_anodized', '#d4af37', '#18181b', '#dc2626',
    '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#18181b" stroke="#d4af37" stroke-width="2"/><path d="M14 14 L26 28 L38 14" fill="none" stroke="#d4af37" stroke-width="2.5"/><text x="112" y="26" text-anchor="middle" fill="#facc15" font-family="Georgia,serif" font-style="italic" font-size="16" font-weight="700" letter-spacing="1.2">Bel Air</text></svg>',
    '1955–1957 Tri-Five Chevrolet Bel Air gold script and V-emblem.'
  ),
  (
    'Chevrolet', 'Bel Air', NULL, NULL, '2-Door', 1955, 1957,
    'body_silhouette', 'SPORT COUPE (2-DR HARDTOP)', 'Pillarless 2-Door Hardtop Sport Coupe (Style 2454)', 'Style 2454', 'Roofline',
    'midcentury_sans', 'chrome_bezel', '#18181b', '#facc15', '#e5e7eb',
    '<svg viewBox="0 0 195 40" xmlns="http://www.w3.org/2000/svg"><path d="M8 28 L30 28 L44 13 L86 13 L102 28 L118 28" fill="none" stroke="#facc15" stroke-width="2.2"/><text x="155" y="24" text-anchor="middle" fill="#f9fafb" font-family="Arial,sans-serif" font-size="9.5" font-weight="800" letter-spacing="1">2-DR HARDTOP</text></svg>',
    'Tri-Five Bel Air 2-Door Pillarless Hardtop Sport Coupe silhouette.'
  ),
  (
    'Chevrolet', 'Bel Air', NULL, NULL, '4-Door', 1955, 1957,
    'body_silhouette', '4-DOOR SEDAN / SPORT SEDAN', '4-Door Pillar/Pillarless Sedan (Style 2403/2439)', 'Style 2403', 'Roofline',
    'midcentury_sans', 'chrome_bezel', '#18181b', '#e5e7eb', '#38bdf8',
    '<svg viewBox="0 0 195 40" xmlns="http://www.w3.org/2000/svg"><path d="M8 28 L28 28 L40 13 L92 13 L106 28 L118 28 M66 13 L66 28" fill="none" stroke="#38bdf8" stroke-width="2.2"/><text x="155" y="24" text-anchor="middle" fill="#f9fafb" font-family="Arial,sans-serif" font-size="9.5" font-weight="800" letter-spacing="1">4-DR SEDAN</text></svg>',
    'Tri-Five Bel Air 4-Door Sedan / Townsman silhouette.'
  ),

  -- Chevrolet Chevelle & Camaro Muscle Era Marks
  (
    'Chevrolet', 'Chevelle', 'SS 396', 'SS (Super Sport)', NULL, 1965, 1972,
    'trim_badge', 'CHEVELLE SS 396 / 454', '1965–1972 Super Sport Grille & Fender Emblem (RPO Z15)', 'RPO Z15/Z25', 'Grille Bar & Front Fender',
    'heavy_slab', 'chrome_bezel', '#111827', '#f9fafb', '#dc2626',
    '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#111827" stroke="#e5e7eb" stroke-width="2.2"/><rect x="14" y="9" width="56" height="22" rx="2" fill="#b91c1c" stroke="#f9fafb" stroke-width="1.5"/><text x="42" y="25" text-anchor="middle" fill="#ffffff" font-family="Arial Black,sans-serif" font-size="14" font-weight="900" letter-spacing="1.5">SS</text><text x="128" y="25" text-anchor="middle" fill="#f9fafb" font-family="Arial,sans-serif" font-size="12.5" font-weight="800" letter-spacing="2">396 · 454</text></svg>',
    '1965–1972 Chevrolet Chevelle Super Sport (SS 396 / SS 454 LS6) heavy-bezel emblem.'
  ),
  (
    'Chevrolet', 'Camaro', 'Z/28', 'Z/28', NULL, 1967, 1981,
    'trim_badge', 'CAMARO Z/28', '1967–1981 RPO Z28 Special Performance Package Emblem', 'RPO Z28', 'Grille & Front Fender',
    'heavy_slab', 'chrome_bezel', '#111827', '#dc2626', '#f9fafb',
    '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="181" height="30" rx="2" fill="#111827" stroke="#e5e7eb" stroke-width="2.2"/><text x="92" y="27" text-anchor="middle" fill="#ef4444" stroke="#f9fafb" stroke-width="0.8" font-family="Arial Black,Impact,sans-serif" font-size="19" font-weight="900" letter-spacing="2.5">Z/28</text></svg>',
    'Factory Chevrolet Camaro RPO Z28 Trans-Am homologation grille/fender emblem.'
  ),
  (
    'Chevrolet', 'Camaro', 'IROC-Z', 'IROC-Z', NULL, 1985, 1990,
    'trim_badge', 'IROC-Z', '1985–1990 3rd Gen Camaro Rocker Panel & Bumper Callout', 'RPO B4Z', 'Lower Door Rocker Panel',
    'extended_sans', 'flush_bezel', '#111827', '#d4af37', '#dc2626',
    '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="181" height="30" rx="2" fill="#111827" stroke="#d4af37" stroke-width="2"/><text x="92" y="26" text-anchor="middle" fill="#facc15" font-family="Arial Black,sans-serif" font-size="16" font-weight="900" letter-spacing="3.5">IROC-Z</text></svg>',
    '1985–1990 3rd-Gen Chevrolet Camaro IROC-Z (RPO B4Z) door graphic.'
  ),

  -- Ford Mustang Boss / Mach 1 / Shelby & Bronco
  (
    'Ford', 'Mustang', 'Boss 302', NULL, 'Fastback', 1969, 1970,
    'series_badge', 'BOSS 302 / 429', '1969–1970 Trans-Am C-Stripe & NASCAR Hemi Callout', NULL, 'Front Fender C-Stripe',
    'western_slab', 'decal_stripe', '#111827', '#facc15', '#f97316',
    '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#111827" stroke="#facc15" stroke-width="2"/><text x="95" y="26" text-anchor="middle" fill="#facc15" font-family="Georgia,serif" font-size="14" font-weight="900" letter-spacing="2.8">BOSS 302·429</text></svg>',
    '1969–1970 Ford Mustang Boss 302 (Larry Shinoda C-stripe) & Boss 429 Kar-Kraft callout.'
  ),
  (
    'Ford', 'Mustang', 'Mach 1', NULL, 'Fastback', 1969, 1973,
    'series_badge', 'MACH 1', '1969–1973 SportsRoof Stencil Rocker & Decklid Graphic', 'Body 63C', 'Rocker Panel & Tail Panel',
    'heavy_slab', 'decal_stripe', '#111827', '#dc2626', '#facc15',
    '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="181" height="30" rx="2" fill="#18181b" stroke="#dc2626" stroke-width="2"/><text x="92" y="26" text-anchor="middle" fill="#f87171" font-family="Arial Black,sans-serif" font-size="16" font-weight="900" letter-spacing="3.5">MACH 1</text></svg>',
    '1969–1973 Ford Mustang Mach 1 SportsRoof (Body 63C) stencil badge.'
  ),
  (
    'Ford', 'Mustang', 'Shelby GT350', NULL, NULL, 1965, 1970,
    'series_badge', 'SHELBY GT350 / GT500', 'Carroll Shelby Cobra Jet & Le Mans Stripe Crest', NULL, 'Front Fender & Grille',
    'extended_sans', 'chrome_bezel', '#003478', '#ffffff', '#dc2626',
    '<svg viewBox="0 0 205 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="201" height="30" rx="2" fill="#003478" stroke="#ffffff" stroke-width="2"/><line x1="6" y1="11" x2="199" y2="11" stroke="#ffffff" stroke-width="1.5"/><line x1="6" y1="29" x2="199" y2="29" stroke="#ffffff" stroke-width="1.5"/><text x="102" y="25" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="11.5" font-weight="900" letter-spacing="2.2">SHELBY GT350·500</text></svg>',
    '1965–1970 Shelby American GT350 / GT500 Guardsman Blue & Wimbledon White rocker/fender badge.'
  ),
  (
    'Ford', 'Bronco', NULL, NULL, NULL, 1966, 1977,
    'model_wordmark', 'EARLY BRONCO (U13/U14/U15)', '1966–1977 1st Gen Bucking Horse Script Fender Emblem', 'U15 Wagon', 'Front Fender above Sidemarker',
    'cursive_script', 'chrome_bezel', '#18181b', '#f9fafb', '#dc2626',
    '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><rect x="138" y="8" width="44" height="24" fill="#b91c1c"/><text x="70" y="26" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-style="italic" font-size="15.5" font-weight="700" letter-spacing="1">Bronco</text><text x="160" y="24" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="8.5" font-weight="800" letter-spacing="1">SPORT</text></svg>',
    '1966–1977 1st-Gen Ford Bronco (U13 Roadster, U14 Half-Cab Pickup, U15 Wagon) chrome script & red Sport crest.'
  ),

  -- Porsche 911 Targa & Turbo (930)
  (
    'Porsche', '911', NULL, NULL, 'Targa', 1967, 2035,
    'body_silhouette', '911 TARGA', 'Brushed Stainless Roll-Bar Hoop & Gold Targa Script', NULL, 'B-Pillar Roll Hoop',
    'cursive_script', 'brushed_aluminum', '#18181b', '#d4af37', '#e5e7eb',
    '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="181" height="30" rx="2" fill="#18181b" stroke="#d4af37" stroke-width="2"/><path d="M18 28 L24 12 L34 12 L38 28" fill="#d4d4d8"/><text x="108" y="26" text-anchor="middle" fill="#facc15" font-family="Georgia,serif" font-style="italic" font-size="16" font-weight="700" letter-spacing="1.5">targa</text></svg>',
    'Porsche 911 Targa brushed stainless B-pillar safety hoop and lowercase gold script.'
  ),
  (
    'Porsche', '911', '911 Turbo', NULL, NULL, 1975, 1989,
    'series_badge', '911 TURBO (930)', '1975–1989 Type 930 Whale-Tail Decklid Script', 'Type 930', 'Rear Engine Lid',
    'cursive_script', 'anodized_black', '#111111', '#f9fafb', '#dc2626',
    '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="181" height="30" rx="2" fill="#09090b" stroke="#e5e7eb" stroke-width="2"/><text x="92" y="27" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-style="italic" font-size="18" font-weight="700" letter-spacing="1.5">turbo</text></svg>',
    '1975–1989 Porsche 911 Turbo (Type 930) flowing lowercase decklid script.'
  )
ON CONFLICT (unique_identity_mark_idx)
DO UPDATE SET
  display_label = EXCLUDED.display_label,
  sub_label = EXCLUDED.sub_label,
  rpo_code = EXCLUDED.rpo_code,
  fender_placement = EXCLUDED.fender_placement,
  svg_markup = EXCLUDED.svg_markup,
  provenance_note = EXCLUDED.provenance_note;

COMMIT;
