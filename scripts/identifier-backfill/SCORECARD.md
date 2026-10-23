# Extractor scorecard: identifierClaims.ts on all 356 profiles

Run `75259a3e-3ab1-44f3-a05a-361b9d328602`. Scope: all 4279 live Porsche 356 profiles (lower(make)='porsche', model 356*, deleted_at null), read-only, 3 id-ordered pages.
Ground truth is the listing itself: the title (listing_title, else model) for body style and replica, and the existing chassis-shaped vin where that number also appears in the description for chassis.

| Field | Precision | Recall |
|---|---|---|
| chassis number (n=243) | 100.0% (232/232) | 95.5% (232/243) |
| body style, title held out: rule range, then text (n=2180) | 96.9% (1870/1929) | 85.8% (1870/2180) |
| body style, chassis rule range only | 98.5% (1428/1450) | 65.5% (1428/2180) |
| body style, text only (previous behaviour) | 88.2% (1430/1622) | 65.6% (1430/2180) |
| replica, vs a title that says replica/re-creation/tribute (n=442) | not measured | 88.2% (390/442) |
| engine/trans/body numbers, Kardex, COA, numbers claims | no independent label yet | not measured |

Deployed precedence is title, then chassis rule range, then text. Body sources: title 2086, rule 311, text 198, none 1192.
Claims: chassis 566 (529 in a cited range, 37 out of range), engine 324, transmission 80, body_number 4, Kardex 524, COA 686; numbers matching 484, non-matching 68; replica 509.
Dedup: 78 chassis numbers on more than one profile (180 profiles). 74 groups (171 profiles) are high confidence: chassis in a cited range, years within 1 of each other and of the range, and bodies agreeing with the range.
Photo/capture-set reads use the same rules: `identifier_rule_for()` and `land_identifier_claims(p_source_kind => 'photo', p_source_image_id => ...)`.
