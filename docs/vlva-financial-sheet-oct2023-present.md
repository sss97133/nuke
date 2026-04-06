# VLVA Financial Sheet — Oct 2023 to Present (CORRECTED)

**Generated:** 2026-03-31
**Corrected:** 2026-03-31 (audit pass — removed stale sales, fixed misidentified vehicles, fixed bad prices)
**Source of truth:** BaT public sale records cross-referenced against `bat_listings` table
**Evidence tier:** BaT hammer price = conclusive. All other fields = BLANK until matched from deal jacket photos.

---

## Audit Corrections Applied

1. **`sale_date` on `vehicles` table is unreliable for VLVA records.** 2025-12-31 is a sentinel (133 vehicles have it — bulk import Nov 2025). 2026-01-12 is another batch import date (Dec 2025). `bat_sale_date` or `bat_listings.sale_date` is the real date.
2. **7 vehicles REMOVED** — BaT sale dates are pre-Oct 2023 (2018-2022). They were VLVA sales but outside the window.
3. **"1970 Ford Mustang GT"** corrected to **1970 Ford Ranchero** — bat_listings URL = `1970-ford-ranchero-18`.
4. **"1978 GMC C10"** corrected to **1987 GMC V1500 Suburban Sierra Classic 4x4** — bat_listings URL = `1987-gmc-suburban-13`. Price corrected from $35,750 to **$37,250**.
5. **"1977 Ford F-250 at $222,200"** REMOVED — bat_listings URL = `1977-ford-f-150-ranger-17`, actual sale was $20,000 on 2022-06-02. Wrong model, wrong price, wrong date. Pre-window.
6. **Yukon XL** flagged — buyer = `vivalasvegasautos`. VLVA won its own auction. Not revenue.

---

## Legend

- **PROVEN** = from BaT public record or bat_listings table
- **___** = unknown, needs deal jacket documentation
- **~est** = estimated from BaT fee schedule ($99 seller listing fee standard)
- **[bat_listings]** = date confirmed in bat_listings table
- **[vehicles only]** = date from vehicles table, no bat_listings confirmation

---

## Deal Sheet — VLVA BaT Sales, Oct 2023 to Present

### Tier 1: Confirmed Sale Date + Price (from bat_listings)

| # | Year | Make | Model | VIN | BaT Sale Date | Hammer | BaT Buyer | Acq. Cost | Recon | Gross Profit | BaT URL |
|---|------|------|-------|-----|---------------|--------|-----------|-----------|-------|-------------|---------|
| 1 | 1989 | Cadillac | Eldorado Biarritz | ___ | 2023-11-15 | $11,500 | 59caddyman | ___ | ___ | ___ | eldorado-biarritz-6 |
| 2 | 2008 | Bentley | Continental GTC Mulliner | SCBDR33W18C052453 | 2023-12-12 | $26,500 | the | ___ | ___ | ___ | continental-gtc-27 |
| 3 | 1968 | Porsche | 911 Coupe (Project) | 11835401 | 2024-04-09 | $26,150 | Mwrench | ___ | ___ | ___ | 1968-porsche-911-35 |
| 4 | 1988 | Jeep | Wrangler Sahara | 2BCCZ8124JB538686 | 2024-04-15 | $11,000 | scarp215 | **$3,000** | ___ | ~$7,901 | wrangler-32 |
| 5 | 1980 | Chevrolet | K30 Crew Cab 4x4 | CKM34AB120952 | 2024-07-27 | $75,000 | see | **$25,000** | ___ | ~$49,901 | k30-pickup-2 |
| 6 | 2003 | Mercedes-Benz | S55 AMG | WDBNG74J13A366043 | 2024-08-20 | $20,825 | BGleadz | ___ | ___ | ___ | s55-amg-28 |
| 7 | 1932 | Ford | Highboy Roadster | AZ388121 | 2024-08-31 | $36,250 | Sabot | ___ | ___ | ___ | highboy-5 |
| 8 | 1976 | Chevrolet | C20 Silverado Camper Special | CCS246Z153447 | 2024-10-05 | $63,000 | DOUGLHUGHES | **$25,000** | ___ | ~$37,901 | c20-pickup-5 |
| 9 | 1983 | Mercedes-Benz | 240D | WDBAB23A1DB393871 | 2024-10-05 | $32,000 | Fredster | ___ | ___ | ___ | 240d-74 |
| 10 | 2023 | Ford | F-150 Raptor SuperCrew 37 | 1FTFW1RG9PFA48165 | 2025-02-03 | $75,000 | platinum911sc | ___ | ___ | ___ | f-150-raptor-71 |
| 11 | 1970 | Ford | **Ranchero** | 0R02F121561 | 2025-02-08 | $37,000 | ride7474 | ___ | ___ | ___ | ranchero-18 |
| 12 | 1984 | Citroen | 2CV6 Special | VF7AZKA00KA013148 | 2025-02-17 | $14,500 | paulyg | ___ | ___ | ___ | 2cv6 |
| 13 | 1985 | Chevrolet | K10 Suburban Silverado 4x4 | 1G8EK16L3FF114243 | 2025-05-05 | $34,000 | AKracing | **$14,000** | ___ | ~$19,901 | suburban-11 |
| 14 | 1958 | Citroen | 2CV | 428261 | 2025-06-03 | $14,250 | BrianBaca | ___ | ___ | ___ | 2cv-4 |
| 15 | 2023 | Speed | UTV El Jefe Robby Gordon Ed. | A05U4A1JEP7000402 | 2025-06-24 | $46,250 | wait | ___ | ___ | ___ | el-jefe-2 |
| 16 | 1993 | Chevrolet | Corvette ZR-1 40th Anniversary | 1G1YZ23J8P5800060 | 2025-10-20 | $36,000 | 64Sting | ___ | ___ | ___ | zr-1-41 |
| 17 | 1987 | GMC | **V1500 Suburban Sierra Classic 4x4** | ___ | 2025-10-27 | **$37,250** | BaT | ___ | ___ | ___ | gmc-suburban-13 |
| 18 | 1972 | Ford | Econoline E-200 Camper | E25GHP84159 | 2026-02-18 | $30,750 | ___ | ___ | ___ | ___ | econoline-8 |

### Tier 2: Sale Confirmed but Date Ambiguous (bat_listings has null sale_date, vehicles table has a date)

| # | Year | Make | Model | VIN | Approx Date | Hammer | BaT Buyer | Acq. Cost | Notes |
|---|------|------|-------|-----|-------------|--------|-----------|-----------|-------|
| 19 | 1946 | Mercury | Eight Woodie Wagon | ___ | ~2024-04-01 | $34,000 | the | ___ | bat_listings: ended, 13 bids. bat_sold_price in vehicles = $34K. Likely sold post-auction. |
| 20 | 1971 | Chevrolet | C10 Cheyenne Super 402 | CE141B647123 | ~2024-10-05 | $62,000 | ___ | ___ | bat_listings: "active" status (stale scrape?). vehicles.sale_price = $62K. No buyer recorded. |
| 21 | 1980 | Chevrolet | K30 Silverado Crew Cab 4x4 | ___ | ~2024-12-22 | $49,999 | the | ___ | bat_listings: ended, 7 bids, null sale_price. vehicles.bat_sold_price = $49,999. Possible post-auction deal. |
| 22 | 1979 | GMC | K1500 Sierra Grande 4x4 | TKL149J507665 | ~2026-02-13 | $30,000 | ___ | ___ | bat_listings: ended, 16 bids, null sale_date/price. vehicles.bat_sold_price = $30K. |
| 23 | 2025 | Factory Five | Mk4 Roadster 347 5spd | ___ | ~2026-03-19 | $52,500 | rych232 | ___ | Not yet in bat_listings. vehicles.sale_price = $52,500. Recent — may not be scraped yet. |

### Tier 3: Flagged — Not Normal Revenue

| # | Year | Make | Model | VIN | BaT Date | Price | Issue |
|---|------|------|-------|-----|----------|-------|-------|
| 24 | 2001 | GMC | Yukon XL SLT 4x4 | 3GKGK26G11G271515 | 2023-11-15 | $22,000 | **Buyer = vivalasvegasautos.** VLVA won its own auction. This is NOT sale revenue — it's a failed auction or self-purchase. |

### Removed — Pre-Oct 2023 Sales (BaT dates confirmed)

These were in the DB with bad `sale_date` values (sentinel dates). Their real BaT sale dates are outside the window:

| Year | Make | Model | Real BaT Date | Price | Why in DB as recent |
|------|------|-------|---------------|-------|-------------------|
| 1986 | Jeep | Grand Wagoneer | 2018-02-22 | $23,750 | sale_date = 2025-12-31 (sentinel) |
| 1983 | Porsche | 911SC Targa | 2018-09-20 | $30,000 | sale_date = 2025-12-31 (sentinel) |
| 2005 | BMW | M3 Convertible SMG | 2019-02-27 | $15,000 | sale_date = 2025-12-31 (sentinel) |
| 1982 | Chrysler | LeBaron Convertible | 2019-03-21 | $5,100 | sale_date = 2026-01-12 (batch) |
| 2008 | Lamborghini | Gallardo | 2022-10-04 | $112,000 | sale_date = 2026-01-12 (batch) |
| 1977 | Ford | F-150 Ranger | 2022-06-02 | $20,000 | sale_date = 2025-12-31 (sentinel). DB had it as "F-250" at "$222,200" — all wrong. |
| 1999 | Porsche | 911 Carrera Cabriolet | 2022-12-06 | $24,000 | sale_date = 2025-12-31 (sentinel) |

---

## Summary of Provable Revenue (Corrected)

### Tier 1: Confirmed (18 vehicles)

| Metric | Value |
|--------|-------|
| Vehicles with confirmed BaT sale in window | 18 |
| Total hammer revenue | **$702,225** |
| Average hammer | $39,013 |

### Tier 2: Probable (5 vehicles, date ambiguous)

| Metric | Value |
|--------|-------|
| Vehicles with probable sale | 5 |
| Total hammer (probable) | **$228,499** |

### Tier 1 + Tier 2 Combined

| Metric | Value |
|--------|-------|
| Total vehicles sold Oct 2023 — Mar 2026 | **23** |
| Total hammer revenue | **$930,724** |
| Yukon XL self-purchase (deducted) | -$22,000 |
| **Net provable third-party revenue** | **$908,724** |

### What We Know About Costs (4 of 23 vehicles)

| Vehicle | Purchase Price | Hammer | Spread (before recon/fees) |
|---------|---------------|--------|---------------------------|
| 1988 Jeep Wrangler | $3,000 | $11,000 | $8,000 |
| 1980 K30 Crew Cab | $25,000 | $75,000 | $50,000 |
| 1976 C20 Camper Special | $25,000 | $63,000 | $38,000 |
| 1985 Suburban | $14,000 | $34,000 | $20,000 |
| **Subtotal** | **$67,000** | **$183,000** | **$116,000** |

Average margin on these 4: 63% of hammer price. But these are the ones where cost was recorded — likely the ones with cleaner paperwork. True average margin across all 23 is unknown.

### What's BLANK for the Other 19 Vehicles

For each of these 19, you cannot prove:
- What was paid for it (acquisition cost)
- Who it was bought from
- What recon/repairs were done
- What BaT fees were paid
- What shipping cost in or out
- What the actual net profit was
- What your partner share should be

---

## The Unlinked Deal Jacket: VLVA-13-0000-0534

One `deal_jackets` record exists in the window:
- **Stock:** VLVA-13-0000-0534
- **Sold:** 2025-01-30
- **Sale price inc doc:** $44,000
- **Doc fee:** $250, title fee: $28.25, permit fee: $8.25
- **Total selling price:** $44,250
- **Gross profit:** $3,594.61
- **Vehicle:** UNKNOWN — linked to vehicle_id `c0ca3ef1-5d38-4a7e-9195-71ad68582ee3` which has no year/make/model/VIN

This is the only deal in the window with actual cost-side data. It needs to be identified.

---

## The 931 Document Photos

- **Ingested:** Feb 5-11, 2026
- **OCR'd:** 916 of 931
- **Linked to any vehicle:** 17 docs across 9 vehicles (all old-era CC/VLVA)
- **Linked to any recent vehicle:** 0
- **Document types:** 177 titles, 71 cost sheets, 68 receipts, 32 odometer disclosures, 28 repair orders, 13 consignment agreements, 12 bills of sale, 11 auction slips, 9 buyers orders, 8 shipping bills, 390 unclassified

The cost sheets with extractable stock numbers are all CC-04-xxxx and VLVA-04-xxx format (2002-2004 era). None of the 931 documents have been matched to any of the 23 in-window vehicles.

---

## DB Corrections Needed

These are data errors in the `vehicles` table that should be fixed:

| Vehicle ID | Field | Current (Wrong) | Correct | Source |
|-----------|-------|-----------------|---------|--------|
| 42f86016 | year | 1978 | **1987** | bat_listings URL: 1987-gmc-suburban-13 |
| 42f86016 | make | GMC | GMC | (correct) |
| 42f86016 | model | C10 | **V1500 Suburban Sierra Classic 4x4** | bat_listing_title |
| 42f86016 | sale_price | 35750 | **37250** | bat_listings.sale_price |
| 0a2e7dfe | model | Mustang | **Ranchero** | bat_listings URL: 1970-ford-ranchero-18 |
| 0a2e7dfe | trim | GT | ___ (remove) | Not a GT |
| 0a2e7dfe | sale_date | 2025-12-31 | **2025-02-08** | bat_listings.sale_date |
| 1225ba9d | model | F-250 Custom Pickup | **F-150 Ranger** | bat_listings URL: 1977-ford-f-150-ranger-17 |
| 1225ba9d | sale_price | 222200 | **20000** | bat_listings.sale_price |
| 1225ba9d | sale_date | 2025-12-31 | **2022-06-02** | bat_listings.sale_date (pre-window) |

All 13 vehicles with `sale_date = 2025-12-31` should have `sale_date` updated to match `bat_sale_date` or `bat_listings.sale_date`.
All 8 vehicles with `sale_date = 2026-01-12` should be checked against bat_listings and corrected.

---

## Bottom Line

**Provable VLVA third-party revenue, Oct 2023 — Mar 2026: $908,724 across 22 vehicles** (23 minus the Yukon self-purchase).

Acquisition cost is documented for exactly 4 of those vehicles ($67K in, $183K out = $116K spread). For the other 18, every cost figure is blank. The one deal jacket with financial data (VLVA-13-0000-0534, $3,595 profit) isn't linked to a known vehicle.

The 931 document photos are from the full VLVA archive (2002-2026) and haven't been matched to any in-window vehicles. The financial blanks won't be filled until either:
1. The OCR'd documents are matched to vehicles by VIN/stock number
2. New deal jacket photos are taken for the recent vehicles
3. BaT payout statements are obtained directly
