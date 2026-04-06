# K5 Blazer Wire Cost Analysis: Tefzel vs TXL

Generated: 2026-04-05 | Source: ProWire USA actual catalog prices (scraped)

## Summary

| Tier | Insulation | Temp Rating | Total Wire Cost | Cost/ft avg |
|------|-----------|-------------|-----------------|-------------|
| **TXL (standard)** | XLPE | 125C | **$72.50** | $0.08/ft |
| **M22759/32 Tefzel (professional)** | ETFE | 150C | **$336.74** | $0.37/ft |
| **Premium** | | +25C | **$264.24** | 4.6x |

The K5 build uses 905.4 ft of wire across 123 conductors in 9 gauges. Upgrading
the entire harness from TXL to Tefzel adds $264 to the wire-only cost.

## Cost by Gauge

| AWG | Footage | Colors | Tefzel $/ft | TXL $/ft | Tefzel Cost | TXL Cost | Premium |
|-----|---------|--------|-------------|----------|-------------|----------|---------|
| 4   | 9.2 ft  | 2      | N/A*        | N/A*     | $32.20*     | $9.20*   | $23.00  |
| 8   | 23.0 ft | 2      | N/A**       | $0.992   | $46.00**    | $22.82   | $23.18  |
| 10  | 23.0 ft | 2      | N/A**       | $0.514   | $23.00**    | $11.82   | $11.18  |
| 12  | 27.6 ft | 5      | $1.348      | $0.332   | $37.20      | $9.16    | $28.04  |
| 14  | 142.8 ft| 16     | $0.697      | $0.138   | $99.53      | $19.71   | $79.82  |
| 16  | 20.7 ft | 3      | $0.452      | $0.109   | $9.36       | $2.26    | $7.10   |
| 18  | 408.7 ft| 49     | $0.346      | $0.078   | $141.41     | $31.88   | $109.53 |
| 20  | 103.0 ft| 18     | $0.249      | $0.061   | $25.65      | $6.28    | $19.37  |
| 22  | 125.5 ft| 21     | $0.188      | $0.056   | $23.59      | $7.03    | $16.56  |

*4 AWG: Marine battery cable ($3.50/ft Tefzel equivalent, est. $1.00/ft TXL)
**8/10 AWG: ProWire doesn't stock M22759/32 in 8/10 AWG; use M22759/16 ($9.25/ft for 8AWG, $4.60/ft for 10AWG) or marine cable

## Tefzel Price Ranges by Gauge (ProWire USA, actual)

| AWG | Min $/ft | Avg $/ft | Max $/ft | Cheapest Color | Most Expensive |
|-----|----------|----------|----------|----------------|---------------|
| 28  | $0.250   | $0.334   | $0.405   | Brown/Yellow/White | Black/Gray |
| 26  | $0.145   | $0.156   | $0.166   | Red/Blue/White | Yellow/Violet |
| 24  | $0.131   | $0.157   | $0.183   | White          | Brown/Gray    |
| 22  | $0.156   | $0.188   | $0.223   | White          | Black         |
| 20  | $0.207   | $0.249   | $0.269   | White          | Violet        |
| 18  | $0.317   | $0.346   | $0.358   | White          | Brown/Orange+ |
| 16  | $0.427   | $0.452   | $0.465   | White          | Orange/Yellow+|
| 14  | $0.553   | $0.697   | $1.000   | White          | Yellow        |
| 12  | $0.916   | $1.348   | $1.926   | White          | Violet/Gray   |

## Striped Wire Premium

Striped M22759/32 Tefzel costs 2-4x more than solid per foot:

| AWG | Solid Avg | Striped Avg | Multiplier |
|-----|-----------|-------------|------------|
| 22  | $0.188    | $0.63       | 3.4x       |
| 20  | $0.249    | $0.88       | 3.5x       |
| 18  | $0.346    | $1.12       | 3.2x       |
| 16  | $0.452    | $1.10       | 2.4x       |
| 14  | $0.697    | $1.75       | 2.5x       |

The K5 harness uses 49 colors in 18 AWG alone. With striped Tefzel, 18 AWG
alone would cost $457 instead of $141. Total harness with all striped wires
where needed would be approximately **$800-1,000** vs $337 for all-solid.

## Recommendation

For the K5 Blazer build:

1. **Use Tefzel solid colors** for the 10 base colors needed per gauge ($337 total)
2. **Use Tefzel striped** only where wire identification absolutely requires it
   (typically only in-loom runs with >10 same-gauge wires sharing a route)
3. **Alternative**: Use TXL ($73) and save $264, but lose the 150C temp rating
   and military-grade insulation. Given this is a show truck with an LS3
   producing significant underhood heat, Tefzel is the right choice.

## Notes

- Prices scraped from prowireusa.com on 2026-04-05
- ProWire does not stock M22759/32 in 4, 8, or 10 AWG (use M22759/16 or battery cable)
- TXL prices are average across all colors for each gauge
- Shielded cable (22 AWG, 4 runs @ 4.6ft = 18.4ft) priced separately (~$2-4/ft)
- Twisted pair (22 AWG CAN bus, 3.5ft) priced separately (~$1-2/ft)
- All 89 Tefzel solid-color products indexed in wire_catalog table
- 8 TXL reference prices indexed for tier-switching comparison

## Data Source

All prices from ProWire USA (prowireusa.com), the primary US distributor of
Marmon Aerospace M22759/32 Tefzel wire. Prices are "as low as" per-foot
pricing (best price at highest quantity break). Actual cost may be slightly
higher for small orders.
