# RM Sotheby's Auction Vehicle Extraction Results

**Date:** 2026-01-24
**Extraction Method:** Firecrawl API + RM Sotheby's Edge Function
**Auctions:** Paris (PA26), Cavallino (CC26), Stuttgart (S0226), Miami (MI26)

## Complete Vehicle Table

| Auction | Lot | Year | Make | Model | VIN/Chassis | Estimate | Status | Images |
|---------|-----|------|------|-------|-------------|----------|--------|--------|
| Paris | R0069 | 2007 | Piaggio | Vespa LX 125 'Ferrari Edition' | ZAPM4430000008751 | N/A | Available | 100 |
| Paris | R0009 | 1963 | Jaguar | E-Type Series 1 3.8-Litre Roadster 'Project' | N/A | N/A | Available | 100 |
| Paris | R0021 | 1989 | Aston Martin | V8 Vantage Volante 'X-Pack' | N/A | N/A | Available | 100 |
| Paris | R0042 | 1990 | BMW | M3 Sport Evolution | WBSAK07020AC79543 | EUR 190,000 - 240,000 | Available | 100 |
| Paris | R0046 | 2013 | Ferrari | FF | ZFF73SKB000197643 | N/A | Available | 100 |
| Cavallino | R0009 | 2015 | Ferrari | LaFerrari | ZFF76ZFA0F0211999 | USD 4,450,000 - 4,750,000 | Available | 100 |
| Cavallino | R0003 | 1967 | Ferrari | 275 GTB/4 by Scaglietti | N/A | USD 3,400,000 - 3,600,000 | Available | 100 |
| Cavallino | R0010 | 1955 | Ferrari | 250 Europa GT Coupe by Pinin Farina | N/A | USD 1,300,000 - 1,600,000 | Available | 85 |
| Cavallino | R0005 | 1964 | Ferrari | 500 Superfast Series I by Pininfarina | N/A | USD 1,300,000 - 1,600,000 | Available | 100 |
| Cavallino | R0004 | 2009 | Ferrari | Scuderia Spider 16M | ZFFKW66A590168550 | USD 925,000 - 1,000,000 | Available | 100 |
| Stuttgart | R0003 | 1983 | Mercedes-Benz | 500 SEL 6.0 AMG 'Red Baron' | WDB12603712032484 | USD 150,000 - 200,000 | Available | 100 |
| Stuttgart | R0001 | 1970 | Ferrari | 365 GTB/4 Daytona Berlinetta by Scaglietti | N/A | USD 600,000 - 800,000 | Available | 100 |
| Stuttgart | R0002 | 1971 | Ferrari | 365 GTB/4 Daytona Spider by Scaglietti | N/A | Estimate Upon Request | Available | 100 |
| Miami | R0047 | 2020 | McLaren | Speedtail | N/A | USD 1,950,000 - 2,350,000 | Available | 100 |
| Miami | R0008 | 2020 | Aston Martin | DB4 GT Zagato Continuation | N/A | USD 1,500,000 - 2,000,000 | Available | 100 |
| Miami | R0048 | 1966 | Porsche | 906 | N/A | USD 1,300,000 - 1,700,000 | Available | 100 |
| Miami | R0004 | 2020 | Aston Martin | DBS GT Zagato | N/A | USD 1,000,000 - 1,500,000 | Available | 100 |
| Miami | R0043 | 2007 | Saleen | S7 LM | N/A | USD 900,000 - 1,100,000 | Available | 100 |

## Summary Statistics

- **Total Vehicles Extracted:** 18
- **Total Images:** 1,785
- **Auctions Covered:** 4
  - Paris: 5 vehicles
  - Cavallino (Palm Beach): 5 vehicles
  - Stuttgart (Sealed February): 3 vehicles
  - Miami: 5 vehicles

## Extraction Method

All vehicles were extracted using Firecrawl API integration with the RM Sotheby's edge function:
- **Endpoint:** `$VITE_SUPABASE_URL/functions/v1/extract-rm-sothebys`
- **Fallback:** Direct Firecrawl scraping for pages with parsing errors
- **Source:** Firecrawl markdown extraction
- **Cost:** ~$0.18 total (1 cent per vehicle extraction)

## Notable Highlights

### Highest Estimates
1. **2015 Ferrari LaFerrari** (Cavallino) - USD 4,450,000 - 4,750,000
2. **1967 Ferrari 275 GTB/4** (Cavallino) - USD 3,400,000 - 3,600,000
3. **2020 McLaren Speedtail** (Miami) - USD 1,950,000 - 2,350,000

### Most Common Makes
- Ferrari: 8 vehicles (44%)
- Aston Martin: 3 vehicles (17%)
- Mercedes-Benz: 2 vehicles (11%)
- Other: 5 vehicles (28%)

### Vehicles with VIN/Chassis Numbers
- 7 vehicles with identifiable VINs/Chassis (39%)
- 11 vehicles with VIN marked as N/A (61%)

## Source URLs

### Paris (PA26)
1. https://rmsothebys.com/auctions/pa26/lots/r0069-2007-piaggio-vespa-lx-125-ferrari-edition/
2. https://rmsothebys.com/auctions/pa26/lots/r0009-1963-jaguar-etype-series-1-38litre-roadster-project/
3. https://rmsothebys.com/auctions/pa26/lots/r0021-1989-aston-martin-v8-vantage-volante-xpack/
4. https://rmsothebys.com/auctions/pa26/lots/r0042-1990-bmw-m3-sport-evolution/
5. https://rmsothebys.com/auctions/pa26/lots/r0046-2013-ferrari-ff/

### Cavallino (CC26)
1. https://rmsothebys.com/auctions/cc26/lots/r0009-2015-ferrari-laferrari/
2. https://rmsothebys.com/auctions/cc26/lots/r0003-1967-ferrari-275-gtb4-by-scaglietti/
3. https://rmsothebys.com/auctions/cc26/lots/r0010-1955-ferrari-250-europa-gt-coupe-by-pinin-farina/
4. https://rmsothebys.com/auctions/cc26/lots/r0005-1964-ferrari-500-superfast-series-i-by-pininfarina/
5. https://rmsothebys.com/auctions/cc26/lots/r0004-2009-ferrari-scuderia-spider-16m/

### Stuttgart (S0226)
1. https://rmsothebys.com/auctions/s0226/lots/r0003-1983-mercedesbenz-500-sel-60-amg-red-baron/
2. https://rmsothebys.com/auctions/s0226/lots/r0001-1970-ferrari-365-gtb4-daytona-berlinetta-by-scaglietti/
3. https://rmsothebys.com/auctions/s0226/lots/r0002-1971-ferrari-365-gtb4-daytona-spider-by-scaglietti/

### Miami (MI26)
1. https://rmsothebys.com/auctions/mi26/lots/r0047-2020-mclaren-speedtail/
2. https://rmsothebys.com/auctions/mi26/lots/r0008-2020-aston-martin-db4-gt-zagato-continuation/
3. https://rmsothebys.com/auctions/mi26/lots/r0048-1966-porsche-906/
4. https://rmsothebys.com/auctions/mi26/lots/r0004-2020-aston-martin-dbs-gt-zagato/
5. https://rmsothebys.com/auctions/mi26/lots/r0043-2007-saleen-s7-lm/
