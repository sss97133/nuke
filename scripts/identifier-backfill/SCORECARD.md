# Extractor scorecard: identifierClaims.ts on all Porsche 356 profiles (run 75259a3e-3ab1-44f3-a05a-361b9d328602)
Scope: 4279 live 356 profiles (lower(make)='porsche', model 356*, deleted_at null), 3282 with description. Pulled read-only in 3 id-ordered pages.

| Field | Ground truth used | Precision | Recall |
|---|---|---|---|
| chassis number | existing 4-6 digit vin that also appears in the text (243 rows) | 95.5% (232/243) | 95.5% (232/243) |
| body style | body word in the model/title field (2367 rows) | 87.6% (1292/1475) | 54.6% (1292/2367) |
| replica, numbers claim, engine/trans/body no., Kardex, COA | no independent label yet | not measured | not measured |

Chassis rule check (seed ranges): 529 in range, 37 out of range.
Claims: chassis 566, engine 324, transmission 80, body_number 4, Kardex 524, COA 686.
Labels: matching 484, non-matching 68, replica 509; body SPEEDSTER 833, COUPE 902, CABRIOLET 360, CONVERTIBLE_D 141, ROADSTER 108, HARDTOP 51.
Dedup: 78 chassis numbers on more than one profile, 180 profiles (dedup_candidates.json).
Known weaknesses: body recall is low because the first body word in the description wins ("Speedster" heritage prose); the next step is to prefer the title, then the Kardex/rule body, then the text. Chassis ground truth only covers rows where the vin is in the text, so recall on cars with no vin is unmeasured. The replica regex was tightened after spot checks ("replica wheels", "a tribute to precision").
