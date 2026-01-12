## Vehicle Profile Data Health Report

Generated: 2026-01-12T10:05:27.798Z

### Inputs

- bat missing data audit: `bat-missing-data-audit.json` (audit_date: 2026-01-12T10:05:20.597Z)
- profile source audit: `profile_audit_results.json` (timestamp: 2026-01-06T18:35:17.204Z)

### Coverage

- unique vehicles covered: 1217
- vehicles with completeness (BaT missing audit): 996
- vehicles with extraction accuracy audit: 240
- vehicles with both: 19

### Completeness signals (BaT missing-data audit)

- total vehicles audited: 1000
- vehicles needing fix: 996
- audit_version: 2
- missing_score stats: count=996, min=1, median=3, avg=2.905, max=15 (max_possible=19)

#### Missing field counts (top 12)

- location: 654
- trim: 494
- comments: 339
- drivetrain: 239
- sale_info: 220
- color: 141
- images: 57
- mileage: 48
- vin: 47
- engine_size: 21
- transmission: 13
- external_listing: 4

#### Notes

- Related-table checks (comments/images/events/listings) are chunked + paginated and will fail fast on Supabase query errors (audit_version>=2).

### Extraction verifiability (profile source audit)

- total audited: 240
- status breakdown: source_fetch_failed=88, checked=152
- accuracy avg (all): 0.158
- accuracy avg (checked only): 0.25

#### Fetch failures by domain (top 10)

- carsandbids.com: failures=80/80 (100%)
- velocityrestorations.com: failures=7/7 (100%)
- broadarrowauctions.com: failures=1/44 (2.3%)

### Worst offenders (top 25)

- 1975 Ducati In (`https://bringatrailer.com/listing/1975-ducati-900`) :: missing_score=15
- 2020 Porsche Carrera S Cabriolet (`https://bringatrailer.com/listing/2020-porsche-911-carrera-s-cabriolet-19`) :: missing_score=14
- ? Table 48 (`https://bringatrailer.com/listing/table-48`) :: missing_score=8
- ? Sign 365 (`https://bringatrailer.com/listing/sign-365`) :: missing_score=8
- 2025 No a Trailer (`https://bringatrailer.com/listing/sign-347`) :: missing_score=7
- 2022 Porsche 911 GT3 Touring (`https://bringatrailer.com/listing/2022-porsche-911-gt3-touring-140`) :: missing_score=7
- 2019 Mercedes-Benz amg gt63 s (`https://bringatrailer.com/listing/2019-mercedes-amg-gt63-s-7`) :: missing_score=7
- 1977 Fiat 131 for sale (`https://bringatrailer.com/listing/1977-fiat-131-rally-abarth`) :: missing_score=7
- 2025 No a Trailer (`https://bringatrailer.com/listing/sign-349`) :: missing_score=7
- 2025 No Audi R8 (Type 4S) (`https://bringatrailer.com/listing/sign-367`) :: missing_score=7
- 2025 No a Trailer (`https://bringatrailer.com/listing/sign-337`) :: missing_score=7
- 1977 Ford F- XLT (`https://bringatrailer.com/listing/1977-ford-f-150-ranger-17`) :: missing_score=6
- 1986 Chevrolet Corvette Convertible 4-Speed (`https://bringatrailer.com/listing/1986-chevrolet-corvette-convertible-48`) :: missing_score=6
- 1963 Chevrolet corvette coupe (`https://bringatrailer.com/listing/1963-chevrolet-corvette-coupe-187`) :: missing_score=6
- 1957 Maserati 200SI by Fantuzzi (`https://bringatrailer.com/listing/1957-maserati-200si`) :: missing_score=6
- 1974 Ford Bronco 302 4-Speed (`https://bringatrailer.com/listing/1974-ford-bronco-347`) :: missing_score=6
- 1985 Lola T900s Race CAR (`https://bringatrailer.com/listing/1985-lola-t900s-race-car`) :: missing_score=6
- 1969 Jaguar e type series ii coupe (`https://bringatrailer.com/listing/1969-jaguar-e-type-series-ii-coupe-7`) :: missing_score=6
- 1972 Jeep Commando V8 (`https://bringatrailer.com/listing/1972-jeep-commando-31`) :: missing_score=6
- 2007 Porsche 911 Carrera S Coupe 6-Speed (`https://bringatrailer.com/listing/2007-porsche-911-carrera-s-coupe-80`) :: missing_score=6
- 1986 Jeep Grand Wagoneer (`https://bringatrailer.com/listing/1986-jeep-grand-wagoneer-2`) :: missing_score=6
- 1930 Ford model a (`https://bringatrailer.com/listing/1930-ford-model-a-298`) :: missing_score=6
- 1970 Honda CT70 Trail (`https://bringatrailer.com/listing/1970-honda-ct70-trail-105`) :: missing_score=6
- 2016 Mercedes -AMG GT S Track Car (`https://bringatrailer.com/listing/2016-mercedes-amg-gt-s-73`) :: missing_score=6
- ? 44 Years OF Porsche Parts Books Tools AND Manuals (`https://bringatrailer.com/listing/44-years-of-porsche-parts-books-tools-and-manuals`) :: missing_score=6

### Top fix levers (highest ROI)

- If your BaT audit is old: re-run `scripts/audit-bat-missing-data.js` (audit_version>=2) so related-table completeness (comments/images/events/listings) is measured reliably (chunked, paginated, fails on errors).
- For BaT completeness: prioritize backfilling `vin`, `trim`, `engine_size`, `drivetrain`, `location`, and `sale_info` because those are the most frequent/high-impact missing fields in the BaT audit.
- For auction linkage: ensure BaT vehicles reliably create `auction_events` rows (source='bat') and associated `external_listings` records so downstream comments/bids/images attach to a stable event identity.
- For source verifiability: stop relying on direct HTML fetch for sources that rate-limit/block (e.g., Cars & Bids 403). Use a crawler service, caching, and/or an ingestion path that does not depend on scraping protected pages.
