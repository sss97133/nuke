## TODO: VIN Data Gaps

~1,978 BaT vehicles without VINs (as of 2026-01-25)
- Mostly pre-1981 classics where BaT pages don't list VIN/chassis
- ~490 in 1970-1980 range
- ~50 post-1981 (race cars, go-karts, JDM imports, kit cars)

Potential fixes:
- Manual entry for high-value vehicles
- Cross-reference with registry databases
- Flag as 'vin_not_available' vs 'vin_missing'

Script: /tmp/extract_vins_by_year.sh <start> <end> <batch_size>

