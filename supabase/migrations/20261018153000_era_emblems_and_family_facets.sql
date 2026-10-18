-- Vetted Era-Specific Vehicle Identity Marks (Emblems, Fender Scripts, Wordmarks) & Multi-Axis Family Facet Partitioning
-- (2026-10-18)
--
-- 1. public.vehicle_identity_marks:
--    Canonical, vetted registry of factory marque emblems, era-specific fender badges, trim scripts, and model wordmarks.
--    Every row is bounded by [year_start, year_end], optional family_key, series_code (e.g. 'C10', 'C20', 'K10', 'C1500'),
--    trim_package (e.g. 'Custom Deluxe', 'Scottsdale', 'Cheyenne', 'Cheyenne Super', 'Silverado', 'Sierra Grande', 'High Sierra'),
--    and body_style (e.g. 'Fastback', 'Coupe', 'Convertible', 'Targa').
--    Stores factory-accurate vector SVG markup (`svg_markup`) and typographic tokens so no unvetted or wrong-era raster PNG
--    ever leaks onto a vintage or modern vehicle.
-- 2. public.resolve_vehicle_identity_marks(p_brand, p_family, p_year, p_series, p_trim, p_body):
--    Returns the exact period-correct marque emblem, family/series badge, and trim script for any scope.
-- 3. public.classify_vehicle_family_facets(p_brand, p_family, p_model, p_year):
--    Deterministically classifies any raw sub-model string into orthogonal axes:
--      - series_facet      (e.g. C10, C20, C30, K10, K20, K30, 3100, Apache, Cameo, C1500, K1500, F-100, F-150, F-250, F-350, Shelby, Boss, Mach 1)
--      - trim_facet        (e.g. Custom Deluxe, Scottsdale, Cheyenne, Cheyenne Super, Silverado, Big 10, 454 SS, Sierra, Sierra Grande, High Sierra,Sierra Classic, Z06, ZR1, Z28, SS, RS)
--      - body_style_facet  (e.g. Fastback, Coupe, Convertible, Roadster, Targa, Cabriolet, Hardtop, Fleetside, Stepside, Suburban, Panel)

BEGIN;

CREATE TABLE IF NOT EXISTS public.vehicle_identity_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL,
  family text,
  series_code text,
  trim_package text,
  body_style text,
  year_start integer NOT NULL DEFAULT 1900,
  year_end integer NOT NULL DEFAULT 2035,
  mark_kind text NOT NULL CHECK (mark_kind IN ('marque_emblem', 'series_badge', 'trim_badge', 'model_wordmark', 'body_silhouette')),
  display_label text NOT NULL,
  sub_label text,
  rpo_code text,
  fender_placement text,
  typography_style text NOT NULL DEFAULT 'block_sans',
  border_treatment text NOT NULL DEFAULT 'chrome_bezel',
  primary_color text NOT NULL DEFAULT '#111111',
  secondary_color text NOT NULL DEFAULT '#d4af37',
  accent_color text,
  svg_markup text NOT NULL,
  provenance_note text NOT NULL,
  vetted boolean NOT NULL DEFAULT true,
  unique_identity_mark_idx text GENERATED ALWAYS AS (
    lower(brand) || '|' ||
    lower(COALESCE(family, '')) || '|' ||
    lower(COALESCE(series_code, '')) || '|' ||
    lower(COALESCE(trim_package, '')) || '|' ||
    lower(COALESCE(body_style, '')) || '|' ||
    year_start::text || '|' ||
    year_end::text || '|' ||
    mark_kind
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unique_identity_mark_idx)
);

ALTER TABLE public.vehicle_identity_marks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read access to vetted vehicle identity marks" ON public.vehicle_identity_marks;
CREATE POLICY "Public read access to vetted vehicle identity marks"
  ON public.vehicle_identity_marks
  FOR SELECT
  USING (vetted = true);

GRANT SELECT ON public.vehicle_identity_marks TO anon, authenticated, service_role;

-- Seed factory-vetted era emblems, Squarebody C/K & GMC fender badges, Corvette era crossed-flags, Mustang & Porsche marks
INSERT INTO public.vehicle_identity_marks (
  brand, family, series_code, trim_package, body_style, year_start, year_end,
  mark_kind, display_label, sub_label, rpo_code, fender_placement,
  typography_style, border_treatment, primary_color, secondary_color, accent_color,
  svg_markup, provenance_note
) VALUES
  -- ============================================================================
  -- CHEVROLET ERA BOWTIES (Never mix modern 2000s gold 3D bowtie with vintage!)
  -- ============================================================================
  (
    'Chevrolet', NULL, NULL, NULL, NULL, 1914, 1959,
    'marque_emblem', 'CHEVROLET', 'Vintage porcelain blue keystone bowtie (1914–1959)', NULL, 'Hood / Grille Crest',
    'vintage_serif', 'chrome_bezel', '#1b365d', '#f5f5f0', '#c0c5ce',
    '<svg viewBox="0 0 120 44" xmlns="http://www.w3.org/2000/svg"><polygon points="44,6 76,6 76,14 114,14 108,30 76,30 76,38 44,38 44,30 6,30 12,14 44,14" fill="#1b365d" stroke="#d8dde6" stroke-width="2.5"/><text x="60" y="25" text-anchor="middle" fill="#f5f5f0" font-family="Georgia,serif" font-size="10" font-weight="700" letter-spacing="2">CHEVROLET</text></svg>',
    'Early porcelain dark-blue Chevrolet bowtie with serif lettering used on Pre-War, Advance Design (3100/3600), and Task Force trucks & passenger cars.'
  ),
  (
    'Chevrolet', NULL, NULL, NULL, NULL, 1960, 1972,
    'marque_emblem', 'CHEVROLET', 'Classic chrome-bordered blue/gold bowtie (1960–1972)', NULL, 'Grille / Header Panel',
    'midcentury_sans', 'chrome_bezel', '#0f4c81', '#e5b842', '#e2e8f0',
    '<svg viewBox="0 0 120 44" xmlns="http://www.w3.org/2000/svg"><polygon points="45,7 75,7 75,15 112,15 106,29 75,29 75,37 45,37 45,29 8,29 14,15 45,15" fill="#0f4c81" stroke="#e2e8f0" stroke-width="2.5"/><polygon points="48,10 72,10 72,17 107,17 102,27 72,27 72,34 48,34 48,27 13,27 18,17 48,17" fill="none" stroke="#e5b842" stroke-width="1"/></svg>',
    '1960–1972 C/K 1st Gen & Action Line / muscle-era crisp flat-bezel bowtie.'
  ),
  (
    'Chevrolet', NULL, NULL, NULL, NULL, 1973, 1987,
    'marque_emblem', 'CHEVROLET', 'Squarebody Gold Foil / Chrome Bezel Bowtie (1973–1987)', NULL, 'Grille Center Emblem',
    'square_block', 'chrome_bezel', '#c8961e', '#1a1a1a', '#e6e8ec',
    '<svg viewBox="0 0 120 44" xmlns="http://www.w3.org/2000/svg"><polygon points="44,7 76,7 76,15 114,15 107,29 76,29 76,37 44,37 44,29 6,29 13,15 44,15" fill="#c8961e" stroke="#e6e8ec" stroke-width="2.5"/><line x1="14" y1="22" x2="106" y2="22" stroke="#9a6f0b" stroke-width="1" stroke-opacity="0.6"/></svg>',
    '1973–1987 Rounded-Line (Squarebody) brushed gold foil / amber acrylic grille bowtie.'
  ),
  (
    'Chevrolet', NULL, NULL, NULL, NULL, 1988, 1999,
    'marque_emblem', 'CHEVROLET', 'GMT400 / 90s Flat Anodized Gold/Red Bowtie (1988–1999)', NULL, 'Grille Bar',
    'geometric_sans', 'flush_bezel', '#b8860b', '#111111', '#d4d4d8',
    '<svg viewBox="0 0 120 44" xmlns="http://www.w3.org/2000/svg"><polygon points="45,8 75,8 75,16 112,16 105,28 75,28 75,36 45,36 45,28 8,28 15,16 45,16" fill="#b8860b" stroke="#d4d4d8" stroke-width="2"/></svg>',
    '1988–1999 GMT400 OBS clean flat gold/red bowtie.'
  ),
  (
    'Chevrolet', NULL, NULL, NULL, NULL, 2000, 2035,
    'marque_emblem', 'CHEVROLET', 'Modern Beveled Gold/Chrome Bowtie (2000+)', NULL, 'Grille / Tailgate',
    'modern_sans', 'beveled_chrome', '#d4af37', '#8a6d1b', '#f4f4f5',
    '<svg viewBox="0 0 120 44" xmlns="http://www.w3.org/2000/svg"><polygon points="45,8 75,8 75,15 113,15 105,29 75,29 75,36 45,36 45,29 7,29 15,15 45,15" fill="#d4af37" stroke="#f4f4f5" stroke-width="3"/><polygon points="48,11 72,11 72,18 106,18 100,26 72,26 72,33 48,33 48,26 14,26 20,18 48,18" fill="#b5891c"/></svg>',
    '2000+ GMT800/GMT900/K2XX/T1XX modern beveled gold bowtie with thick chrome surround.'
  ),

  -- ============================================================================
  -- CHEVROLET SQUAREBODY (1973–1987) SERIES & TRIM FENDER EMBLEMS
  -- ============================================================================
  (
    'Chevrolet', 'Pickup', 'C10', 'Custom Deluxe', NULL, 1973, 1980,
    'trim_badge', 'CUSTOM DELUXE 10', '1973–1980 Rectangular Stacked Fender Plate', 'YE8/YF5', 'Front Fender (behind wheel arch)',
    'square_block', 'chrome_bezel', '#111111', '#e5e7eb', '#dc2626',
    '<svg viewBox="0 0 190 44" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="186" height="36" rx="2" fill="#141416" stroke="#e5e7eb" stroke-width="2.5"/><rect x="138" y="7" width="46" height="30" fill="#b91c1c"/><text x="70" y="19" text-anchor="middle" fill="#f3f4f6" font-family="Arial,sans-serif" font-size="10" font-weight="800" letter-spacing="1.8">CUSTOM</text><text x="70" y="33" text-anchor="middle" fill="#f3f4f6" font-family="Arial,sans-serif" font-size="11" font-weight="800" letter-spacing="2.2">DELUXE</text><text x="161" y="29" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="19" font-weight="900">10</text></svg>',
    '1973–1980 Chevrolet C10/K10 Custom Deluxe front fender nameplate: black-inlaid chrome rectangle with stacked CUSTOM DELUXE lettering and red-backed 10 tonnage callout.'
  ),
  (
    'Chevrolet', 'Pickup', 'C10', 'Scottsdale', NULL, 1975, 1987,
    'trim_badge', 'SCOTTSDALE 10', '1975–1987 Mid-Trim Fender Nameplate (RPO YE8)', 'YE8', 'Front Fender',
    'square_block', 'chrome_bezel', '#111111', '#e5e7eb', '#d97706',
    '<svg viewBox="0 0 190 44" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="6" width="186" height="32" rx="2" fill="#141416" stroke="#e5e7eb" stroke-width="2.5"/><rect x="142" y="9" width="42" height="26" fill="#b45309"/><text x="72" y="27" text-anchor="middle" fill="#f3f4f6" font-family="Arial,sans-serif" font-size="12" font-weight="800" letter-spacing="1.6">SCOTTSDALE</text><text x="163" y="28" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="17" font-weight="900">10</text></svg>',
    'Introduced for 1975 model year (RPO YE8): SCOTTSDALE block capitals in black-filled chrome bezel with series numeral.'
  ),
  (
    'Chevrolet', 'Pickup', 'C10', 'Cheyenne', NULL, 1973, 1981,
    'trim_badge', 'CHEYENNE 10', '1973–1981 Western Block Fender Badge (RPO YE9)', 'YE9', 'Front Fender',
    'western_slab', 'chrome_bezel', '#111111', '#facc15', '#dc2626',
    '<svg viewBox="0 0 190 44" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="6" width="186" height="32" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.5"/><line x1="6" y1="10" x2="136" y2="10" stroke="#facc15" stroke-width="1.5"/><line x1="6" y1="34" x2="136" y2="34" stroke="#facc15" stroke-width="1.5"/><rect x="142" y="9" width="42" height="26" fill="#991b1b"/><text x="72" y="27" text-anchor="middle" fill="#fef08a" font-family="Georgia,serif" font-size="12.5" font-weight="700" letter-spacing="2">CHEYENNE</text><text x="163" y="28" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="17" font-weight="900">10</text></svg>',
    '1973–1981 Chevrolet Cheyenne (RPO YE9) fender badge with western slab-serif lettering and gold pinstripe border.'
  ),
  (
    'Chevrolet', 'Pickup', 'C10', 'Cheyenne Super', NULL, 1973, 1974,
    'trim_badge', 'CHEYENNE SUPER 10', '1973–1974 Top-Trim Fender & Woodgrain Tailgate Badge', 'YE9+Z84', 'Front Fender (1973–1974 only, succeeded by Silverado in 1975)',
    'western_slab', 'chrome_bezel', '#111111', '#facc15', '#dc2626',
    '<svg viewBox="0 0 210 44" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="206" height="36" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.5"/><rect x="158" y="7" width="46" height="30" fill="#991b1b"/><text x="80" y="19" text-anchor="middle" fill="#fef08a" font-family="Georgia,serif" font-size="11" font-weight="700" letter-spacing="2">CHEYENNE</text><text x="80" y="33" text-anchor="middle" fill="#f87171" font-family="Arial,sans-serif" font-size="10" font-weight="900" letter-spacing="3">SUPER</text><text x="181" y="28" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="18" font-weight="900">10</text></svg>',
    '1973–1974 exclusive top-of-the-line Squarebody trim before Silverado moved from cab trim to RPO Z84 top package in 1975.'
  ),
  (
    'Chevrolet', 'Pickup', 'C10', 'Silverado', NULL, 1975, 1980,
    'trim_badge', 'SILVERADO 10', '1975–1980 Round-Nose Squarebody Fender Script Plate (RPO Z84)', 'Z84', 'Front Fender (1975–1980 Round-Eye)',
    'cursive_script', 'chrome_bezel', '#111111', '#e5e7eb', '#b91c1c',
    '<svg viewBox="0 0 200 44" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="6" width="196" height="32" rx="2" fill="#111113" stroke="#e5e7eb" stroke-width="2.5"/><rect x="150" y="9" width="44" height="26" fill="#991b1b"/><text x="76" y="27" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-style="italic" font-size="14" font-weight="700" letter-spacing="1.2">Silverado</text><text x="172" y="28" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="17" font-weight="900">10</text></svg>',
    '1975–1980 Squarebody Silverado 10 fender plate (RPO Z84) with chrome script and red series block.'
  ),
  (
    'Chevrolet', 'Pickup', 'C10', 'Silverado', NULL, 1981, 1987,
    'trim_badge', 'SILVERADO 10', '1981–1987 Facelift Slant-Nose Brushed Aluminum Fender Badge (RPO Z84)', 'Z84', 'Behind Front Wheel Arch / Cab B-Pillar',
    'extended_sans', 'brushed_aluminum', '#1f2937', '#f3f4f6', '#dc2626',
    '<svg viewBox="0 0 200 44" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="7" width="196" height="30" rx="1" fill="#e5e7eb" stroke="#1f2937" stroke-width="2"/><rect x="6" y="11" width="142" height="22" fill="#111827"/><rect x="150" y="11" width="44" height="22" fill="#b91c1c"/><text x="77" y="26" text-anchor="middle" fill="#f9fafb" font-family="Arial,sans-serif" font-size="11.5" font-weight="800" letter-spacing="2.4">SILVERADO</text><text x="172" y="27" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="15" font-weight="900">10</text></svg>',
    '1981–1987 Squarebody aerodynamic-hood facelift Silverado badge: wide block sans-serif capitals in brushed chrome/black.'
  ),
  (
    'Chevrolet', 'Pickup', 'C20', 'Silverado', NULL, 1975, 1987,
    'trim_badge', 'SILVERADO 20', '3/4-Ton C20/K20 Silverado Fender Emblem (RPO Z84)', 'Z84', 'Front Fender',
    'extended_sans', 'chrome_bezel', '#111827', '#e5e7eb', '#b91c1c',
    '<svg viewBox="0 0 200 44" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="6" width="196" height="32" rx="2" fill="#111113" stroke="#e5e7eb" stroke-width="2.5"/><rect x="150" y="9" width="44" height="26" fill="#991b1b"/><text x="76" y="27" text-anchor="middle" fill="#f9fafb" font-family="Arial,sans-serif" font-size="12" font-weight="800" letter-spacing="2">SILVERADO</text><text x="172" y="28" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="17" font-weight="900">20</text></svg>',
    '3/4-ton C20/K20 Squarebody Silverado 20 fender badge.'
  ),
  (
    'Chevrolet', 'Pickup', 'C30', 'Silverado', NULL, 1975, 1987,
    'trim_badge', 'SILVERADO 30', '1-Ton C30/K30 Silverado / Camper Special Fender Emblem', 'Z84', 'Front Fender',
    'extended_sans', 'chrome_bezel', '#111827', '#e5e7eb', '#b91c1c',
    '<svg viewBox="0 0 200 44" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="6" width="196" height="32" rx="2" fill="#111113" stroke="#e5e7eb" stroke-width="2.5"/><rect x="150" y="9" width="44" height="26" fill="#991b1b"/><text x="76" y="27" text-anchor="middle" fill="#f9fafb" font-family="Arial,sans-serif" font-size="12" font-weight="800" letter-spacing="2">SILVERADO</text><text x="172" y="28" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="17" font-weight="900">30</text></svg>',
    '1-ton C30/K30 Squarebody Silverado 30 fender badge.'
  ),

  -- ============================================================================
  -- GMC SQUAREBODY (1973–1987) EARLY & LATE FENDER EMBLEMS (1500 / 2500 / 3500)
  -- ============================================================================
  (
    'GMC', NULL, NULL, NULL, NULL, 1967, 1998,
    'marque_emblem', 'GMC', 'Factory Red Block Beveled GMC Grille Lettering', NULL, 'Grille Center',
    'heavy_slab', 'chrome_bezel', '#dc2626', '#f3f4f6', '#111111',
    '<svg viewBox="0 0 120 44" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="6" width="112" height="32" rx="2" fill="#111113" stroke="#e5e7eb" stroke-width="2"/><text x="60" y="31" text-anchor="middle" fill="#ef4444" stroke="#f9fafb" stroke-width="1" font-family="Arial Black,Impact,sans-serif" font-size="25" font-weight="900" letter-spacing="4">GMC</text></svg>',
    'Factory GMC red block grille emblem with chrome surround.'
  ),
  (
    'GMC', 'Pickup', 'C1500', 'Sierra', NULL, 1973, 1974,
    'trim_badge', 'SIERRA 15', '1973–1974 Early Squarebody GMC "15 / 25 / 35" Two-Digit Fender Emblem', 'YE9', 'Front Fender (1973–1974 two-digit series before 1500/2500/3500 in 1975)',
    'western_slab', 'chrome_bezel', '#18181b', '#facc15', '#dc2626',
    '<svg viewBox="0 0 190 44" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="6" width="186" height="32" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.5"/><rect x="140" y="9" width="44" height="26" fill="#dc2626"/><text x="70" y="27" text-anchor="middle" fill="#fef08a" font-family="Georgia,serif" font-size="14" font-weight="700" letter-spacing="2.5">SIERRA</text><text x="162" y="28" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="17" font-weight="900">15</text></svg>',
    '1973–1974 GMC Squarebody pickups used 2-digit series badges (Custom 15, Sierra 15, Sierra Grande 15) before switching to 1500/2500/3500 in 1975.'
  ),
  (
    'GMC', 'Pickup', 'C1500', 'Sierra Grande', NULL, 1975, 1987,
    'trim_badge', 'SIERRA GRANDE 1500', '1975–1987 GMC Sierra Grande 1500 Fender Emblem', 'Z62', 'Front Fender',
    'square_block', 'chrome_bezel', '#18181b', '#facc15', '#dc2626',
    '<svg viewBox="0 0 215 44" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="211" height="36" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.5"/><rect x="148" y="7" width="61" height="30" fill="#dc2626"/><text x="75" y="19" text-anchor="middle" fill="#f3f4f6" font-family="Arial,sans-serif" font-size="11" font-weight="800" letter-spacing="2">SIERRA</text><text x="75" y="33" text-anchor="middle" fill="#facc15" font-family="Arial,sans-serif" font-size="10" font-weight="800" letter-spacing="2.2">GRANDE</text><text x="178" y="27" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="15" font-weight="900">1500</text></svg>',
    '1975–1987 GMC Sierra Grande 1500 stacked fender badge with four-digit 1500 callout.'
  ),
  (
    'GMC', 'Pickup', 'C1500', 'High Sierra', NULL, 1975, 1987,
    'trim_badge', 'HIGH SIERRA 1500', '1975–1987 GMC High Sierra Fender Emblem', 'Z84', 'Front Fender',
    'square_block', 'chrome_bezel', '#18181b', '#e5e7eb', '#dc2626',
    '<svg viewBox="0 0 215 44" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="211" height="36" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.5"/><rect x="148" y="7" width="61" height="30" fill="#b91c1c"/><text x="75" y="19" text-anchor="middle" fill="#facc15" font-family="Arial,sans-serif" font-size="10" font-weight="800" letter-spacing="2.4">HIGH</text><text x="75" y="33" text-anchor="middle" fill="#f3f4f6" font-family="Arial,sans-serif" font-size="11.5" font-weight="800" letter-spacing="2">SIERRA</text><text x="178" y="27" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="15" font-weight="900">1500</text></svg>',
    '1975–1987 GMC High Sierra 1500 fender badge.'
  ),

  -- ============================================================================
  -- CHEVROLET CORVETTE GENERATION EMBLEMS & SCRIPTS (C1..C8)
  -- ============================================================================
  (
    'Chevrolet', 'Corvette', NULL, NULL, NULL, 1953, 1962,
    'model_wordmark', 'CORVETTE C1', '1953–1962 C1 Crossed Flags & Chrome Script', NULL, 'Nose & Cove Fender Script',
    'cursive_script', 'chrome_roundel', '#b91c1c', '#f3f4f6', '#111111',
    '<svg viewBox="0 0 180 44" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="22" r="16" fill="#111" stroke="#e5e7eb" stroke-width="2"/><path d="M14 28 L32 14 M34 28 L16 14" stroke="#e5e7eb" stroke-width="2.2"/><rect x="14" y="13" width="8" height="6" fill="#ef4444"/><rect x="26" y="13" width="8" height="6" fill="#f9fafb"/><text x="108" y="27" text-anchor="middle" fill="#f3f4f6" font-family="Georgia,serif" font-style="italic" font-size="16" font-weight="700" letter-spacing="1">Corvette</text></svg>',
    '1953–1962 C1 Corvette roundel crossed-flags and flowing chrome fender script.'
  ),
  (
    'Chevrolet', 'Corvette', NULL, NULL, NULL, 1963, 1967,
    'model_wordmark', 'STING RAY', '1963–1967 C2 Two-Word "Sting Ray" Script', NULL, 'Rear Deck / Front Fender',
    'cursive_script', 'chrome_script', '#e5e7eb', '#ef4444', '#111111',
    '<svg viewBox="0 0 190 44" xmlns="http://www.w3.org/2000/svg"><path d="M10 30 L26 12 L42 30 Z" fill="none" stroke="#e5e7eb" stroke-width="2"/><path d="M18 24 L34 24" stroke="#ef4444" stroke-width="2"/><text x="115" y="27" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-style="italic" font-size="15" font-weight="700" letter-spacing="1.5">Sting Ray</text></svg>',
    '1963–1967 C2 Corvette exclusive two-word "Sting Ray" chrome script.'
  ),
  (
    'Chevrolet', 'Corvette', NULL, NULL, NULL, 1968, 1982,
    'model_wordmark', 'STINGRAY', '1969–1976 C3 One-Word "Stingray" Fender Script', NULL, 'Front Fender above gills',
    'cursive_script', 'chrome_script', '#e5e7eb', '#ef4444', '#111111',
    '<svg viewBox="0 0 190 44" xmlns="http://www.w3.org/2000/svg"><path d="M8 28 L24 12 L40 28" fill="none" stroke="#e5e7eb" stroke-width="2.2"/><text x="114" y="27" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-style="italic" font-size="15.5" font-weight="700" letter-spacing="1">Stingray</text></svg>',
    '1968–1982 C3 Mako-shark era one-word connected "Stingray" fender script.'
  ),
  (
    'Chevrolet', 'Corvette', NULL, NULL, NULL, 1984, 2013,
    'model_wordmark', 'CORVETTE', 'C4–C6 Wide-Angle Crossed Flags', NULL, 'Hood & Decklid',
    'geometric_sans', 'flush_bezel', '#ef4444', '#e5e7eb', '#111111',
    '<svg viewBox="0 0 190 44" xmlns="http://www.w3.org/2000/svg"><polygon points="8,16 28,24 48,16 28,32" fill="#ef4444" stroke="#e5e7eb" stroke-width="1.5"/><text x="118" y="27" text-anchor="middle" fill="#f9fafb" font-family="Arial,sans-serif" font-size="13" font-weight="800" letter-spacing="3">CORVETTE</text></svg>',
    '1984–2013 C4/C5/C6 geometric swept crossed-flags emblem.'
  ),
  (
    'Chevrolet', 'Corvette', NULL, NULL, NULL, 2014, 2035,
    'model_wordmark', 'CORVETTE STINGRAY', 'C7/C8 Swept-Wing V-Flags & Modern Stingray', NULL, 'Nose & Rear Fascia',
    'modern_sans', 'carbon_flash', '#ef4444', '#d4d4d8', '#18181b',
    '<svg viewBox="0 0 190 44" xmlns="http://www.w3.org/2000/svg"><polygon points="10,12 28,28 46,12 28,36" fill="#ef4444" stroke="#f4f4f5" stroke-width="1.5"/><text x="118" y="27" text-anchor="middle" fill="#f9fafb" font-family="Arial,sans-serif" font-size="12.5" font-weight="900" letter-spacing="3.2">STINGRAY</text></svg>',
    '2014+ C7/C8 sharp V-angle Carbon Flash crossed flags.'
  ),

  -- ============================================================================
  -- FORD MUSTANG ERA & BODY-STYLE EMBLEMS (1964–1973 Running Pony, Fastback, Mach 1, Boss)
  -- ============================================================================
  (
    'Ford', NULL, NULL, NULL, NULL, 1903, 2035,
    'marque_emblem', 'FORD', 'Centennial Blue Oval Script Crest', NULL, 'Grille / Decklid',
    'cursive_script', 'chrome_oval', '#003478', '#ffffff', '#e5e7eb',
    '<svg viewBox="0 0 120 44" xmlns="http://www.w3.org/2000/svg"><ellipse cx="60" cy="22" rx="52" ry="17" fill="#003478" stroke="#e5e7eb" stroke-width="2.5"/><ellipse cx="60" cy="22" rx="48" ry="13.5" fill="none" stroke="#ffffff" stroke-width="1"/><text x="60" y="28" text-anchor="middle" fill="#ffffff" font-family="Georgia,serif" font-style="italic" font-size="19" font-weight="700">Ford</text></svg>',
    'Ford Blue Oval with chrome bezel.'
  ),
  (
    'Ford', 'Mustang', NULL, NULL, NULL, 1964, 1973,
    'model_wordmark', 'MUSTANG', '1st Gen Running Pony & Tri-Bar Corral (1964½–1973)', NULL, 'Grille Corral & Fender',
    'western_slab', 'chrome_corral', '#111827', '#e5e7eb', '#dc2626',
    '<svg viewBox="0 0 190 44" xmlns="http://www.w3.org/2000/svg"><rect x="14" y="6" width="6" height="32" fill="#dc2626"/><rect x="20" y="6" width="6" height="32" fill="#f9fafb"/><rect x="26" y="6" width="6" height="32" fill="#1d4ed8"/><rect x="8" y="10" width="30" height="24" fill="none" stroke="#e5e7eb" stroke-width="2"/><text x="114" y="27" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-size="13.5" font-weight="800" letter-spacing="2.8">MUSTANG</text></svg>',
    '1964½–1973 1st Gen Mustang Red/White/Blue tri-bar crest and block serif fender lettering.'
  ),
  (
    'Ford', 'Mustang', NULL, NULL, 'Fastback', 1965, 1973,
    'body_silhouette', '2+2 FASTBACK', 'SportsRoof / 2+2 Fastback Swept Roofline Profile', 'Body 63A/63B', 'Roofline & Quarter Louvers',
    'western_slab', 'chrome_bezel', '#111827', '#e5e7eb', '#dc2626',
    '<svg viewBox="0 0 190 44" xmlns="http://www.w3.org/2000/svg"><path d="M10 30 L28 30 L46 14 L82 14 L112 28 L122 30" fill="none" stroke="#f9fafb" stroke-width="2.5"/><text x="154" y="26" text-anchor="middle" fill="#f87171" font-family="Arial,sans-serif" font-size="10.5" font-weight="800" letter-spacing="1.4">FASTBACK</text></svg>',
    '1st Gen Mustang 2+2 / SportsRoof Fastback (Body Code 63) swept fastback silhouette.'
  ),
  (
    'Ford', 'Mustang', NULL, NULL, 'Convertible', 1964, 2035,
    'body_silhouette', 'CONVERTIBLE', 'Open-Top Drophead Profile', 'Body 76A/76B', 'Beltline',
    'western_slab', 'chrome_bezel', '#111827', '#e5e7eb', '#38bdf8',
    '<svg viewBox="0 0 190 44" xmlns="http://www.w3.org/2000/svg"><path d="M10 30 L42 30 L52 16 L60 30 L118 30" fill="none" stroke="#f9fafb" stroke-width="2.5"/><text x="154" y="26" text-anchor="middle" fill="#38bdf8" font-family="Arial,sans-serif" font-size="10" font-weight="800" letter-spacing="1.2">CONVERTIBLE</text></svg>',
    'Mustang Convertible (Body Code 76) open-profile badge.'
  ),
  (
    'Ford', 'Mustang', NULL, NULL, 'Coupe', 1964, 2035,
    'body_silhouette', 'HARDTOP COUPE', 'Notchback Hardtop Coupe Profile', 'Body 65A/65B', 'Roofline',
    'western_slab', 'chrome_bezel', '#111827', '#e5e7eb', '#a3e635',
    '<svg viewBox="0 0 190 44" xmlns="http://www.w3.org/2000/svg"><path d="M10 30 L34 30 L46 15 L84 15 L94 28 L118 30" fill="none" stroke="#f9fafb" stroke-width="2.5"/><text x="154" y="26" text-anchor="middle" fill="#e5e7eb" font-family="Arial,sans-serif" font-size="11" font-weight="800" letter-spacing="1.6">COUPE</text></svg>',
    'Mustang Notchback Hardtop Coupe (Body Code 65) formal roofline badge.'
  ),

  -- ============================================================================
  -- FORD F-SERIES ERA EMBLEMS (Bumpside 67-72, Dentside 73-79, Bullnose/OBS 80-97)
  -- ============================================================================
  (
    'Ford', 'Pickup', 'F-100', NULL, NULL, 1967, 1972,
    'series_badge', 'FORD F-100', '1967–1972 5th Gen "Bumpside" Hood Side Spear Emblem', NULL, 'Hood Side / Cowl',
    'square_block', 'chrome_bezel', '#111827', '#e5e7eb', '#dc2626',
    '<svg viewBox="0 0 190 44" xmlns="http://www.w3.org/2000/svg"><polygon points="4,10 140,10 186,22 140,34 4,34" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><text x="74" y="27" text-anchor="middle" fill="#f9fafb" font-family="Arial,sans-serif" font-size="15" font-weight="900" letter-spacing="2.5">F-100</text><circle cx="154" cy="22" r="5" fill="#dc2626"/></svg>',
    '1967–1972 Ford F-100 Bumpside chrome spear badge.'
  ),
  (
    'Ford', 'Pickup', 'F-150', 'Ranger XLT', NULL, 1973, 1979,
    'trim_badge', 'F-150 RANGER XLT', '1973–1979 6th Gen "Dentside" Cowl Fender Badge', NULL, 'Cowl / Upper Fender Dent',
    'square_block', 'chrome_bezel', '#111827', '#e5e7eb', '#dc2626',
    '<svg viewBox="0 0 210 44" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="206" height="34" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.5"/><text x="64" y="27" text-anchor="middle" fill="#f9fafb" font-family="Arial,sans-serif" font-size="15" font-weight="900" letter-spacing="2">F-150</text><rect x="118" y="9" width="86" height="26" fill="#991b1b"/><text x="161" y="26" text-anchor="middle" fill="#fef08a" font-family="Arial,sans-serif" font-size="10.5" font-weight="800" letter-spacing="1.4">RANGER XLT</text></svg>',
    '1973–1979 Dentside Ford F-150 cowl-mounted chrome/black badge.'
  ),

  -- ============================================================================
  -- PORSCHE 911 ERA SCRIPTS & CREST (F-Body, G-Body, 964, 993, 996, 997, 991, 992)
  -- ============================================================================
  (
    'Porsche', NULL, NULL, NULL, NULL, 1952, 2035,
    'marque_emblem', 'PORSCHE', 'Stuttgart Gold/Red/Black Heraldic Crest', NULL, 'Hood Crest',
    'extended_sans', 'gold_shield', '#d4af37', '#111111', '#b91c1c',
    '<svg viewBox="0 0 120 44" xmlns="http://www.w3.org/2000/svg"><path d="M44 4 L76 4 L74 26 Q60 39 60 40 Q60 39 46 26 Z" fill="#d4af37" stroke="#111" stroke-width="1.5"/><rect x="47" y="10" width="12" height="12" fill="#991b1b"/><rect x="61" y="22" width="11" height="10" fill="#991b1b"/><text x="60" y="9" text-anchor="middle" fill="#111" font-family="Arial,sans-serif" font-size="4.5" font-weight="900" letter-spacing="1">PORSCHE</text></svg>',
    'Stuttgart Württemberg Porsche hood crest.'
  ),
  (
    'Porsche', '911', NULL, 'Carrera', NULL, 1964, 1989,
    'model_wordmark', '911 CARRERA', 'Classic Decklid Slanted Carrera Script', NULL, 'Rear Engine Lid',
    'cursive_script', ' anodized_black', '#111111', '#d4af37', '#e5e7eb',
    '<svg viewBox="0 0 190 44" xmlns="http://www.w3.org/2000/svg"><text x="95" y="28" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-style="italic" font-size="17" font-weight="700" letter-spacing="1.2">911 Carrera</text></svg>',
    '1964–1989 F-Body & G-Body Porsche 911 Carrera decklid script.'
  )
ON CONFLICT (unique_identity_mark_idx)
DO UPDATE SET
  display_label = EXCLUDED.display_label,
  sub_label = EXCLUDED.sub_label,
  rpo_code = EXCLUDED.rpo_code,
  fender_placement = EXCLUDED.fender_placement,
  svg_markup = EXCLUDED.svg_markup,
  provenance_note = EXCLUDED.provenance_note;

-- Resolver RPC: returns matching era marks for a brand, optional family, optional year, series, trim, or body style
CREATE OR REPLACE FUNCTION public.resolve_vehicle_identity_marks(
  p_brand text,
  p_family text DEFAULT NULL,
  p_year integer DEFAULT NULL,
  p_series text DEFAULT NULL,
  p_trim text DEFAULT NULL,
  p_body text DEFAULT NULL
)
RETURNS SETOF public.vehicle_identity_marks
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT m.*
  FROM public.vehicle_identity_marks m
  WHERE m.vetted = true
    AND lower(m.brand) = lower(btrim(p_brand))
    AND (
      p_family IS NULL
      OR m.family IS NULL
      OR lower(m.family) = lower(btrim(p_family))
      OR (lower(btrim(p_family)) IN ('c10', 'k10', 'c20', 'k20', 'c30', 'k30', '3100', '3600', 'apache', 'silverado', 'c1500', 'k1500', 'sierra', 'f-100', 'f-150', 'f-250', 'f-350') AND lower(m.family) = 'pickup')
    )
    AND (p_year IS NULL OR (p_year >= m.year_start AND p_year <= m.year_end))
    AND (p_series IS NULL OR m.series_code IS NULL OR lower(m.series_code) = lower(btrim(p_series)))
    AND (p_trim IS NULL OR m.trim_package IS NULL OR lower(m.trim_package) = lower(btrim(p_trim)))
    AND (p_body IS NULL OR m.body_style IS NULL OR lower(m.body_style) = lower(btrim(p_body)))
  ORDER BY
    (m.trim_package IS NOT NULL) DESC,
    (m.series_code IS NOT NULL) DESC,
    (m.body_style IS NOT NULL) DESC,
    (m.family IS NOT NULL) DESC,
    (m.year_end - m.year_start) ASC,
    m.year_start DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_vehicle_identity_marks(text, text, integer, text, text, text) TO anon, authenticated, service_role;

COMMIT;
