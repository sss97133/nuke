-- Migration: Seed vetted identity marks for Toyota Land Cruiser (J40/J55/J60/J80),
-- Porsche (Stuttgart crest, 911 Carrera RS/GT3, 356 Speedster),
-- Chevrolet K/5 Blazer, Pontiac GTO / The Judge / Firebird Trans Am, and Jaguar E-Type / XK.

INSERT INTO public.vehicle_identity_marks (
  brand, family, series_code, trim_package, body_style,
  year_start, year_end, mark_kind, display_label, sub_label,
  rpo_code, fender_placement, typography_style, svg_markup, provenance_note
)
VALUES
  ('Toyota', 'Land Cruiser', 'FJ40', NULL, NULL,
   1960, 1984, 'series_badge', 'TOYOTA LAND CRUISER · FJ40', '1960–1984 J40 4WD Front Apron & Rear Quarter Emblem',
   'FJ40 / FJ43 / FJ45', 'Upper Front Apron & Rear Quarter', 'Cast Chrome TOYOTA & Red/Gold 4WD Quarter Plate',
   '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><rect x="132" y="8" width="52" height="24" fill="#b91c1c"/><text x="68" y="19" text-anchor="middle" fill="#facc15" font-family="Arial Black,sans-serif" font-size="9" font-weight="900" letter-spacing="2">TOYOTA</text><text x="68" y="30" text-anchor="middle" fill="#f9fafb" font-family="Arial,sans-serif" font-size="8.5" font-weight="800" letter-spacing="1.2">LAND CRUISER</text><text x="158" y="25" text-anchor="middle" fill="#ffffff" font-family="Arial Black,sans-serif" font-size="12" font-weight="900">4WD</text></svg>',
   '1960–1984 Toyota J40 (FJ40/FJ43/FJ45/BJ40) cast apron script & red/gold 4WD quarter badge.'),

  ('Toyota', 'Land Cruiser', 'FJ60', NULL, 'Wagon / Carryall',
   1981, 1990, 'series_badge', 'LAND CRUISER · FJ60 / FJ62', '1981–1990 J60 4WD Station Wagon Rear Gate Emblem',
   'FJ60 / FJ62', 'Rear Tailgate & Front Fender', 'Chrome Block Script',
   '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#111827" stroke="#e5e7eb" stroke-width="2"/><text x="95" y="26" text-anchor="middle" fill="#f9fafb" font-family="Arial Black,sans-serif" font-size="12.5" font-weight="900" letter-spacing="2">TOYOTA LAND CRUISER</text></svg>',
   '1981–1990 Toyota Land Cruiser FJ60 & FJ62 4WD station wagon badge.'),

  ('Porsche', NULL, NULL, NULL, NULL,
   1952, 2035, 'marque_emblem', 'PORSCHE · STUTTGART', 'Württemberg Gold/Red/Black Hood Crest & Rear Decklid Script',
   NULL, 'Front Hood Handle & Rear Engine Lid', 'Spaced Zuffenhausen Sans-Serif',
   '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#111827" stroke="#eab308" stroke-width="2"/><path d="M16 7 L38 7 L36 25 Q27 34 27 35 Q27 34 18 25 Z" fill="#eab308" stroke="#dc2626" stroke-width="1.4"/><text x="112" y="26" text-anchor="middle" fill="#fde047" font-family="Arial,sans-serif" font-size="13.5" font-weight="900" letter-spacing="3.5">PORSCHE</text></svg>',
   'Porsche Stuttgart-Zuffenhausen Württemberg crest and spaced rear decklid script.'),

  ('Porsche', '911', 'Carrera RS', NULL, NULL,
   1972, 2035, 'series_badge', 'CARRERA RS · GT3', 'Rennsport Negative Side Script & Ducktail / Wing Callout',
   'M471 / M472 / GT3', 'Lower Door Rocker & Engine Grille', 'Rennsport Brush Script',
   '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#f9fafb" stroke="#dc2626" stroke-width="2.2"/><text x="95" y="26" text-anchor="middle" fill="#dc2626" font-family="Georgia,serif" font-style="italic" font-size="15.5" font-weight="900" letter-spacing="2">Carrera RS</text></svg>',
   'Porsche 911 Carrera RS 2.7 / RS America / 964 RS / 993 RS / GT3 RS rocker & decklid script.'),

  ('Porsche', '356', '356A', NULL, 'Roadster / Speedster',
   1954, 1965, 'series_badge', 'PORSCHE 356 · SPEEDSTER', '1954–1965 Reutter Coachwork Front Fender Gold Script',
   '356 Pre-A / A / B / C', 'Front Fender Behind Wheel Arch', 'Gold Cursive Reutter Script',
   '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#18181b" stroke="#facc15" stroke-width="2"/><text x="95" y="26" text-anchor="middle" fill="#facc15" font-family="Georgia,serif" font-style="italic" font-size="15.5" font-weight="700" letter-spacing="1.8">Speedster · 1600</text></svg>',
   '1954–1965 Porsche 356 Speedster & Super 90 / SC gold cursive fender script.'),

  ('Chevrolet', 'Blazer', 'K5 Blazer', 'Cheyenne', NULL,
   1969, 1991, 'series_badge', 'K/5 BLAZER · CHEYENNE', '''69–''91 Removable-Top K5 Blazer Front Fender Plate',
   'K10514 / K10516', 'Front Fender Behind Wheel Arch', 'Heavy Chrome Block with Red K/5 Callout',
   '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><rect x="134" y="8" width="50" height="24" fill="#b91c1c"/><text x="68" y="26" text-anchor="middle" fill="#f9fafb" font-family="Arial Black,sans-serif" font-size="14" font-weight="900" letter-spacing="2.2">BLAZER</text><text x="159" y="26" text-anchor="middle" fill="#facc15" font-family="Arial Black,sans-serif" font-size="14" font-weight="900">K/5</text></svg>',
   '1969–1991 Chevrolet K/5 Blazer CST / Cheyenne / Silverado removable-hardtop fender plate.'),

  ('Pontiac', 'GTO', 'GTO', NULL, NULL,
   1964, 2006, 'series_badge', 'GTO · THE JUDGE · 6.5 LITRE', 'PMD Red Arrowhead & Ram Air III / IV Fender Callout',
   'W62 / WT1', 'Front Grille, Rear Quarter & Hood Scoop', 'Pontiac Motor Division Block & Psychedelic Judge Script',
   '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#111827" stroke="#f97316" stroke-width="2.2"/><polygon points="22,7 30,20 22,33 14,20" fill="#dc2626" stroke="#e5e7eb" stroke-width="1.2"/><text x="108" y="26" text-anchor="middle" fill="#fb923c" font-family="Arial Black,Impact,sans-serif" font-size="14.5" font-weight="900" letter-spacing="2.2">GTO · THE JUDGE</text></svg>',
   '1964–1974 Pontiac GTO & 1969–1971 The Judge (WT1) Ram Air callout.'),

  ('Pontiac', 'Firebird', 'Firebird Trans Am', NULL, 'Coupe / Hardtop',
   1969, 2002, 'series_badge', 'FIREBIRD TRANS AM · WS6', 'Screaming Eagle Hood Bird & Shaker Scoop 6.6 Litre / SD-455',
   'WS4 / WS6 / Y82', 'Shaker Hood Scoop & Front Fender Vent', 'Trans Am Gothic Decal',
   '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#09090b" stroke="#eab308" stroke-width="2.2"/><text x="95" y="26" text-anchor="middle" fill="#facc15" font-family="Georgia,serif" font-size="14" font-weight="900" letter-spacing="2.4">TRANS AM · 6.6L</text></svg>',
   '1969–2002 Pontiac Firebird Trans Am Shaker scoop & WS6 Special Edition callout.'),

  ('Jaguar', 'E-Type', 'E-Type Series 1', NULL, NULL,
   1948, 2035, 'marque_emblem', 'JAGUAR · E-TYPE · XK', 'Coventry Growler Nose Badge & Series 1/2/3 Boot Lid Script',
   'Series 1 / 2 / 3', 'Bonnet Mouth Bar & Rear Boot Lid', 'Coventry Chrome Serif',
   '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#064e3b" stroke="#e5e7eb" stroke-width="2"/><text x="95" y="26" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-size="14" font-weight="800" letter-spacing="3.2">JAGUAR E-TYPE</text></svg>',
   'Jaguar Cars Ltd. Coventry bonnet badge and XK120/140/150 & E-Type Series 1/2/3 script.')
ON CONFLICT (unique_identity_mark_idx) DO UPDATE SET
  display_label = EXCLUDED.display_label,
  sub_label = EXCLUDED.sub_label,
  rpo_code = EXCLUDED.rpo_code,
  fender_placement = EXCLUDED.fender_placement,
  typography_style = EXCLUDED.typography_style,
  svg_markup = EXCLUDED.svg_markup,
  provenance_note = EXCLUDED.provenance_note;
