# Mileage independent cross-check rule (written before scoring), 2026-10-23
Reference = odometer from a DIFFERENT platform listing of the same vehicle_id (Mecum lot JSON 'odometer'; PCARMARKET listing text), not BaT text.
Pair usable if both have a value and both dates are known. dt = |BaT date - other date| in years.
Agree if: |bat_mi - other_mi| <= max(1000, 0.05*max(bat_mi, other_mi)) + 12000*dt
      AND the later listing's reading >= the earlier one's - max(500, 0.02*earlier)  (odometers don't go backwards)
TMU/rollover listings are still scored (the extractor value is checked, not the truth).
