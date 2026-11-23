# Close-comps fair range for Explore asks (DRAFT, NOT APPLIED)

- `001_ask_close_comps.sql` adds the reader `ask_close_comps(p_vehicle_ids uuid[]) RETURNS jsonb`. It writes nothing.
- `revert_001_ask_close_comps.sql` drops it.

The iOS Explore card puts a classified ask (Craigslist, Facebook Marketplace, KSL) inside a fair range. Today that range
is the model family's sold p25 to p75 over every trim and 20+ years (`mv_family_year_prices`). For vehicle
`2a13d3be-322a-420e-b974-7e82ff468318` (a 1967 Chevrolet "chevelle ss 396" asking $16,000), that range is $41.8k to
$71.5k from 465 sales going back to 2003. This reader gives a range only from close sales. When there aren't enough,
it answers "no_opinion" and says why.

Nothing here is applied. The next steps need the owner's explicit yes:
1. Apply it as a migration.
2. Point the iOS card at it.

## Contract

`ask_close_comps(p_vehicle_ids uuid[])`: STABLE, SECURITY DEFINER, EXECUTE granted to anon and authenticated. Only the
reader block between `BEGIN READER` and `END READER` has been run. The plpgsql wrapper around it has never been
compiled. It takes
at most 60 ids per call and raises 22023 beyond that. It returns `{"as_of", "rows": [...]}`, with one row for each
requested id that is a public, non-deleted vehicle. Each row has these fields:
`vehicle_id`, `verdict` (`range` | `no_opinion`), `reason`, `match {year_from, year_to, make, family, tokens, window_from,
window_to}`, `n`, `low` (p25), `mid` (p50), `high` (p75), `venues`, `condition_known` and `comps` (newest first, at most 25:
`vehicle_id, title, sold_on, price, venue, url`).
- `low`, `mid` and `high` are null on `no_opinion` rows. `match`, `n`, `venues` and `comps` are still filled, so the
  phone can show why.
- `price` and the percentiles are the **gross price**: what the buyer paid, premium included, in USD. The BaT
  figures quoted in the brief were hammer prices. A $39,000 hammer is $40,950 here.

## Rules (all in SQL)

- **Sold lots only, from every house in `auction_events`, in the last 36 months.** That table holds BaT, Mecum,
  Barrett-Jackson, Cars & Bids, PCarMarket and Bonhams. Gooding, RM and the other houses sit in other tables and are
  not read.
- **One price basis: `gross_price`.** Bases are never mixed. A lot with no gross price is left out. Non-USD prices are
  converted with `fx_usd_rate` on the sale date.
- **The shared exclusions from `get_comps_scored`:** `outcome = 'sold'`, not `auction_event_typed_not_sold`, no
  `duplicate_of`, not `vehicle_sale_price_untrusted`, not in `record_quarantine`, and the same `lot_class_of` as the
  subject (no engines, parts or memorabilia).
  - `vehicle_sale_price_untrusted` is called with both the gross and the hammer price.
  - Over the 887 sold Chevelle lots in the window, it flagged 0 under either price, so it may not matter for auction
    lots.
- **One row per lot.**
  - B-J and Mecum pages are sometimes stored twice, with and without `www.` and with different end dates. The URL is
    normalised and the earliest date is kept.
  - The same lot page can also hang off two vehicle records, which happened in 57 subject rows before this fix. It is
    counted once per subject.
- **Same make and model family.** Family comes from `mv_model_family_names`, the same fold the board uses.
- **Model year.** The exact year comes first. The reader widens to ±1 only when the exact year has fewer than 5 sales,
  and `match.year_from` and `match.year_to` say which.
- **Distinguishing words.** The subject's model and trim are cut into words. Before cutting:
  - `SS396` becomes `ss 396`, and `F-350` and `f350` both become `f 350`.
  - `4x4`, `4wd` and `4×4` all become `fourwd`.
  - `N-speed`, `2-door` and `V8` are dropped.

  Then the family name is removed, including when it is written as one word (`landcruiser`), along with the make,
  body words and ad words (`original`, `clean`, `runs`, ...). A close sale must carry every word that is left, in its
  model, its trim or its title.
- **A title is read from its model year on.** "454-Powered 1967 Chevrolet Chevelle SS 396" reads as "Chevrolet Chevelle
  SS 396". What was put in the car is not what the car is.
- **A title that names another car drops the lot.** That is a title with neither the family's words nor the comp's own
  model words. Two B-J "CHEVELLE SS 396" rows carry Corvette and Camaro titles.
- **Body is a class, not a word:** open (convertible, roadster, targa...), wagon, or closed.
  - A known body must not be contradicted.
  - A convertible or wagon subject needs a comp that is known to be one.
  - The comp's body is read from its model, title, `body_style` and listing slug (`.../1967-chevrolet-camaro-convertible/`).
- **Modifiers.** A comp is left out when it carries `tribute`, `clone`, `replica`, `restomod`, `custom`, `project`,
  `modified` or a similar word and the subject doesn't. This applies to the title prefix and slug too. B-J's "Custom"
  lots are restomods at $104k to $198k. `custom deluxe`, `custom cab` and `custom 500` are kept as trims.
- **Gate.** The verdict is `range` when `n >= 5` and `p75/p25 <= 1.75`. Otherwise it is `no_opinion`, with one of these
  reasons:
  - "N close sales in 3 years; 5 needed"
  - "Close sales too spread to say (high is 2.3× low)"
  - "Model not specific enough to match close sales" (no distinguishing word and too spread)
  - "Model not matched to a model family"
- **Never the subject itself, and never a classified ask.** Comps come only from auction lots.

## How it finds sales fast

- `mv_family_sales` is the finder: brand, family and sale date are indexed, and it is refreshed daily by
  `refresh-family-sales` from the same family fold.
- Each candidate is re-read live from `vehicles`. Its lots, prices and dates come live from `auction_events`, and only
  for cars whose words already match.
- Known miss: a car whose `vehicles.sale_date` is older than the window is not found, even if it resold inside the
  window. Measured at 10:58 PT on four exact-year cohorts, counting cars with a gross sold lot in the window:

  | Cohort | Found / live |
  |---|---|
  | 1967 Camaro | 261 / 276 |
  | 1967 Chevelle | 124 / 129 |
  | 2016 F-150 | 16 / 16 |
  | 1999 Tacoma | 45 / 46 |
  | **All four** | **446 / 467 (95.5%)** |

  One Chevelle miss is a 2022 BaT sale that resold at Mecum on 2024-08-17.
- It runs SECURITY DEFINER because `record_quarantine` and `vehicle_lot_class` have RLS with no read policy. Running as
  invoker (anon), it would silently skip those two exclusions. Subjects and comps are limited to public, non-deleted
  vehicles.

## Checked live, 2026-11-22 (Pacific), read-only

The function body was run as a plain SELECT with the ids inlined.

### The Chevelle (11:00 PT)

`2a13d3be…`, asking $16,000:
- `range`, n = 20, all exact year 1967, tokens `396 ss`, window 2023-11-22 to 2026-11-22.
- Low $47,906, mid $59,913, high $63,226.
- Venues: Bring a Trailer 16, Barrett-Jackson 3, Cars & Bids 1. `condition_known` = 10.
- The subject's body is coupe, so SS 396 convertibles are out.
- The B-J "SS 396 Custom Coupe" ($104,500) is out, and so are the Mecum "Chevelle SS" lots with no "396" anywhere.
- The family fold's answer for the same car is $41.8k to $71.5k from 465 sales.

### Census (10:51 to 10:55 PT)

1,724 classified asks: `vehicle_events` from craigslist, facebook_marketplace and ksl created in the last 72 h, newest
per vehicle, joined to public, non-deleted vehicles that are not `non_vehicle_item`. They ran in 44 calls of 40.

| Verdict | Asks |
|---|---|
| `range` | 490 (28%) |
| `no_opinion` | 1,234 |

The family fold gives a range for 1,381 of the same 1,724.

| Reason | Asks |
|---|---|
| "N close sales in 3 years; 5 needed" | 569 (341 with n = 0, 228 with n = 1–4) |
| "Model not specific enough" | 317 |
| "Not matched to a model family" | 203 |
| "Too spread" | 145 |

About the 490 `range` rows:
- 161 match on distinguishing words. 329 have none: the whole family-year, which passed only because its spread was
  already under 1.75×.
- 339 use the exact year and 151 are widened to ±1.
- Median n is 10 (5 to 179).
- `condition_known` totals 1,389 comps; 250 rows have 0.
- Of the 468 priced rows, 339 ask below `low`, 76 sit inside and 53 above. Auction sales are the clean end of the
  market, and most classified asks are daily drivers. The card should say "sold at auction", not "worth".

### Sample `range` rows, comps checked by eye

| Vehicle | Match | n | p25 / p50 / p75 |
|---|---|---|---|
| `348d54db` | 1990 F-250, tokens `lariat xlt` | 8 (BaT 7, Mecum 1) | $12,049 / $13,229 / $13,716 |
| `34ad7c98` | Yukon 2001–2003, tokens `fourwd slt` | 8 | $16,666 / $18,244 / $21,853 |
| `61fe22eb` | 1999 Tacoma, token `fourwd` | 26 | $15,449 / $18,376 / $21,919 |
| `3a4daf05` | XK 1971–1973, token `xke` | 7 | $42,963 / $57,225 / $71,138 |
| `687ec207` | 1967 Camaro coupe, no tokens | 158 (BaT 77, Mecum 72) | $39,375 / $49,816 / $63,600 |

- The 1990 F-250 comps are all XLT Lariats.
- The Yukon comps include one Yukon XL 2500. Extra comp words are allowed.
- The Jaguar comps are all E-Types.

### Wrong matches found in the census and fixed

1. Mecum lots with no body word let convertibles into closed and convertible ranges. The listing slug is now read for
   body.
2. BaT "-Powered" and "Modified" prefixes: the prefix is now kept out of required words and read for modifiers.
3. B-J duplicates (`www.` and bare docket URLs) are now one lot.
4. Titles naming another car are now dropped.
5. `4×4` in titles did not match `4x4` asks. It is now normalised.
6. The one-word family name was also required in comp titles, which dropped good lots. It is now used only to strip
   subject words. The 1967 Land Cruiser case went from 30 to 62 close sales.

### Still open, not fixed by this reader

- **Family-fold errors.** "Trooper" folds to VehiCROSS, "f450 super duty" to F-250, Alfa "164s" to Spider, "delica" to
  Pajero and Saab "93" to 96.
- **Vehicle records with contradicting fields.** One BaT car has model "Mustang Convertible" and title
  "1971 Ford Mustang Boss 351". It counts as a convertible.

### Time

Server time comes from EXPLAIN ANALYZE, run as the privileged role. `anon` and `authenticated` have
`statement_timeout = 15s` (`pg_roles.rolconfig`), and the function sets no limit of its own.

| Call | First run | Repeat run |
|---|---|---|
| 40 ids (4 batches, 10:46 to 11:00 PT) | 2.1–2.9 s | 1.07–1.64 s |
| Chevelle alone | | 0.09 s |

- The repeat runs meet the 1.5 s target for 3 of the 4 batches. `b_ae` (Mustang, F-series, Silverado and S-Class
  families) takes 1.64 s.
- First passes over the 44 batches, wall time including the API round trip:
  - Median 3.7 s and worst 37.5 s.
  - 2 of 44 batches went over 15 s, so those calls would fail with 57014 for anon on the phone.
- 60 ids, the contract cap, was not timed.
- The two largest stages are cutting candidate text into words (about 0.6 s on the largest batch) and the lot lookup
  with its exclusion functions (about 0.8 s).
- Cold reads of the `vehicles` heap are the floor. A precomputed close-sales table would remove them, but that is a
  new fold, so it is not in this draft.
- Until then, the phone should call with 20 ids or fewer.
