# Receipt: the E-seal (C015) part number for every Deutsch DT and DTP housing

- date: 2026-09-29
- change_type: research
- scope: one new file, `docs/wiring/calc-data/catalog/deutsch_eseal.yaml`. parts.yaml, endpoints.yaml, families.yaml and the
  registry are not edited, and nothing reads the new file yet.

## What changed
- `deutsch_eseal.yaml` maps each DT and DTP housing in the catalog to its E-seal part number, the seal's insulation range, which
  of our M22759/32 wire ODs it takes (20 AWG 1.27, 18 AWG 1.52, 16 AWG 1.73, 14 AWG 2.16, 12 AWG 2.62 mm, state row 0ai), and where
  it is in stock and at what price on 2026-09-29. A null is a part or number we did not find.
- 14 of 18 entries have an E-seal PN. The four without: the 6-way DT flange receptacle (DT04-6P-L012), the 4-way DTP flange
  receptacle (DTP04-4P-L012), and the two DTM housings (MoTeC #68054 / #68055).

## Evidence
- Deutsch DT family catalog p.23 (PDF page 7): "The C015 modification offers a reduced diameter insert cavity allowing for a
  proper seal with smaller wire insulation. The C015 modification is also referred to as an 'E' seal." The page lists no PNs and
  no seal range.
- te.com product pages, one per PN (read 2026-09-29): seal code E Seal and "Compatible Insulation Diameter Range":
  DT E-seal 1.35-3.05 mm; the CL03 flange receptacles DT04-12PA-CL03 and DT04-12PC-CL03 1.4-3.8 mm (DT04-12PB-CL03 reads 1.35-3.05);
  DTP E-seal 2.5-4.0 mm. Standard seals for comparison: DT06-2S 2.23-3.68, DTP06-4S 3.4-4.9, DTM06-4S 1.3-3.0, DTM04-4P 1.35-3.05.
- digikey.com keyword pages and product pages (stock, qty-1 price); customconnectorkits.com and buydeutsch.com Shopify product
  endpoints (price, available); prowireusa.com by its SKU path (only DT04-2P-C015 answered).
- The pages were read through the WebFetch tool, which returns a model's summary of the page. Two TE ranges were re-read with a
  verbatim quote and matched; DigiKey stock was re-read on the product page except for two flange parts (noted on the entries).

## What it means for the wire
- 20 AWG at 1.27 mm is under the smallest seal on offer (1.35 mm E-seal; 1.4 mm on the CL03 flange parts), by 0.08-0.13 mm. No DT
  E-seal takes it. 18 and 16 AWG are the only gauges inside both the E-seal range and the size 16 contact (20-16 AWG).
- The standard DT seal (2.23-3.68 mm) takes none of the gauges that fit a size 16 contact.
- DTP: the E-seal (2.5-4.0 mm) takes 12 AWG only; 14 AWG (2.16 mm) is under it. The standard DTP seal takes none of ours.
- DTM has no E-seal PN (te.com 404 for DTM06-4S-C015 and DTM04-4P-C015); its standard seal already reaches 1.3-1.35 mm, and 20 AWG is
  0.03-0.08 mm under that.

## Still open
- The flange E-seal for the 12-way is `CL03`, not `L012-C015`. Whether CL03's flange footprint matches L012 is not on the TE page:
  compare the drawings before it goes in the firewall cutout.
- No flange E-seal PN was found for DT04-6P-L012 or DTP04-4P-L012. The catalog's answer is "consult the factory".
- 20 AWG M22759/32 has no seal that fits at this OD. How to seal it is a design call for the owner and Dave; this file only shows
  the gap.
- mouser.com, newark.com, waytekwire.com and tti.com were not checked; te.com and mouser.com refuse plain curl.
