-- ============================================================================
-- Migration: 20261018171500_mopar_european_identity_marks.sql
-- Purpose:
--   Seed factory-vetted Dodge / Mopar Power Wagon & R/T Scat Pack marks,
--   BMW Motorsport ///M tri-color emblems, Mercedes-Benz W198 300 SL scripts,
--   and Scuderia Ferrari Modena shields into `public.vehicle_identity_marks`.
-- ============================================================================

INSERT INTO public.vehicle_identity_marks (
  brand, family, series_code, trim_package, body_style,
  year_start, year_end, mark_kind, display_label, sub_label,
  rpo_code, fender_placement, svg_markup, provenance_note
)
VALUES
  ('Dodge', 'Pickup', 'Power Wagon', NULL, NULL, 1946, 1980, 'series_badge', 'POWER WAGON', 'Stamped Cowl & Fender 4x4 Nameplate', NULL, 'Hood Side / Front Fender',
   '<svg viewBox="0 0 205 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="201" height="30" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><rect x="8" y="9" width="38" height="22" fill="#b91c1c"/><text x="27" y="24" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="10" font-weight="900">WM300</text><text x="124" y="25" text-anchor="middle" fill="#f9fafb" font-family="Arial Black,sans-serif" font-size="12.5" font-weight="900" letter-spacing="2">POWER WAGON</text></svg>',
   'Dodge Power Wagon (WM300 & W100/W200) heavy-duty 4x4 cowl/fender nameplate.'),

  ('Dodge', NULL, NULL, 'R/T (Road/Track)', NULL, 1967, 1974, 'trim_badge', 'R/T · 440 · HEMI', '1967–1971 Scat Pack Road/Track Grille & Quarter Emblem', 'WS23/XS29', 'Grille & Rear Quarter',
   '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="181" height="30" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><text x="52" y="28" text-anchor="middle" fill="#ef4444" stroke="#f9fafb" stroke-width="0.8" font-family="Arial Black,Impact,sans-serif" font-size="20" font-weight="900" letter-spacing="1.5">R/T</text><text x="132" y="25" text-anchor="middle" fill="#facc15" font-family="Arial,sans-serif" font-size="11.5" font-weight="800" letter-spacing="1.8">426 HEMI</text></svg>',
   'Dodge Charger & Challenger R/T (Road/Track) Scat Pack emblem.'),

  ('BMW', NULL, NULL, 'M-Power', NULL, 1978, 2035, 'trim_badge', '///M MOTORSPORT', 'Bavarian Motorsport Tri-Color Grille & Decklid Badge', NULL, 'Kidney Grille & Rear Decklid',
   '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="181" height="30" rx="2" fill="#111827" stroke="#e5e7eb" stroke-width="2"/><polygon points="18,32 30,8 40,8 28,32" fill="#38bdf8"/><polygon points="28,32 40,8 50,8 38,32" fill="#1e3a8a"/><polygon points="38,32 50,8 60,8 48,32" fill="#ef4444"/><text x="118" y="27" text-anchor="middle" fill="#f9fafb" font-family="Arial Black,sans-serif" font-size="17" font-weight="900" letter-spacing="2">M3 · M5</text></svg>',
   'BMW Motorsport GmbH tri-color slanted M badge (E30 M3, E28/E39 M5, E46, E92, F80).'),

  ('Mercedes-Benz', 'SL', '300SL', NULL, NULL, 1954, 1963, 'series_badge', '300 SL (W198)', '1954–1963 W198 Gullwing Coupe & Roadster Decklid Script', 'W198', 'Rear Decklid',
   '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="181" height="30" rx="2" fill="#111827" stroke="#e5e7eb" stroke-width="2"/><circle cx="26" cy="20" r="11" fill="none" stroke="#e5e7eb" stroke-width="1.8"/><path d="M26 9 L26 20 M26 20 L17 26 M26 20 L35 26" stroke="#e5e7eb" stroke-width="1.8"/><text x="114" y="26" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-style="italic" font-size="16" font-weight="700" letter-spacing="2">300 SL</text></svg>',
   '1954–1963 Mercedes-Benz W198 300 SL Gullwing & Roadster chrome decklid script.'),

  ('Ferrari', NULL, NULL, NULL, NULL, 1947, 2035, 'marque_emblem', 'SCUDERIA FERRARI', 'Modena Giallo Fender Shield & Cavallino Rampante', NULL, 'Front Fender Scuderia Shield',
   '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="181" height="30" rx="2" fill="#991b1b" stroke="#facc15" stroke-width="2"/><path d="M16 7 L38 7 L36 25 Q27 34 27 35 Q27 34 18 25 Z" fill="#facc15" stroke="#111" stroke-width="1.2"/><text x="27" y="29" text-anchor="middle" fill="#111" font-family="Georgia,serif" font-size="7" font-weight="900">S F</text><text x="114" y="26" text-anchor="middle" fill="#fef08a" font-family="Georgia,serif" font-size="14" font-weight="800" letter-spacing="2.8">FERRARI</text></svg>',
   'Scuderia Ferrari Modena yellow fender shield and Pininfarina/Maranello wordmark.')
ON CONFLICT (unique_identity_mark_idx) DO UPDATE SET
  display_label = EXCLUDED.display_label,
  sub_label = EXCLUDED.sub_label,
  rpo_code = EXCLUDED.rpo_code,
  fender_placement = EXCLUDED.fender_placement,
  svg_markup = EXCLUDED.svg_markup,
  provenance_note = EXCLUDED.provenance_note;
