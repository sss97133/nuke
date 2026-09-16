# K5 Materials — Prototype Loom + Formboard

**Generated:** 2026-06-09 · companion to `K5_PROTOTYPE_CUT_PLAN.md`
**Scope:** Dave-method steps ①–③ only (prototype + verify). Production color wire order and ALL connector/terminal PNs are deferred until after on-vehicle verification (locked decision 2026-05-11). **This list contains zero connector part numbers on purpose.**

## A. Prototype wire (pull from Dave's stock first — `K5_wire_neighbor_inventory_request.md`)

Pricing: RaceSpec reference April 2026 (`K5_wire_spec_and_costs.md` Job 3). Buy only the gauges Dave can't cover. One color per gauge; identity rides on printed labels.

| Gauge / spec | Need (ft) | Min order | If buying: qty → cost |
|---|---|---|---|
| 22 AWG M22759/32 | 272 | 100 ft | 300 ft @ $0.52 ≈ **$156** |
| 20 AWG M22759/32 | 153 | 100 ft | 150 ft @ $0.70 ≈ **$105** |
| 18 AWG M22759/32 | 479 | 50 ft | 500 ft @ $1.30 ≈ **$650** |
| 16 AWG M22759/32 | 36 | 50 ft | 50 ft @ $1.38 ≈ **$69** |
| 14 AWG M22759/32 | 124 | 50 ft | 150 ft @ $2.30 ≈ **$345** |
| 12 AWG M22759/32 | 40 | 50 ft | 50 ft @ $3.30 ≈ **$165** |
| 10 AWG M22759/16 | 28 | 50 ft | 50 ft @ $4.60 ≈ **$230** |
| 8 AWG M22759/16 | 29 | 25 ft | 50 ft @ $9.25 ≈ **$463** |
| 4 AWG M22759/16 | 17 | quote | ProWire quote (RaceSpec table stops at 8 AWG) |
| 22 AWG shielded 2-cond (M27500 class) | 25 | — | ProWire quote (CKP/CMP/KS1/KS2) |
| 22 AWG twisted pair (M27500 class) | 15 | — | ProWire quote (CAN #62, TCU ext #125) |

**Worst case, zero Dave stock: ≈ $2,180 + the three quotes.** Every foot of Dave's Tefzel that fits gauge spec cuts this directly — the prototype loom doesn't care about color.

## B. Formboard

Truck wiring envelope is 14.5 ft (front lighting → tailgate cluster, real model). Board at 1:1:

- 2× 4'×8' plywood/OSB sheets, butted end-to-end (16 ft run) on sawhorses
- 1:1 centerline layout transferred from the Blender top view (`K5_harness_formboard_top.png` — print at scale or grid-transfer; major stations marked (model Y-coords, front axle datum): front axle 0", firewall 18.7", FLOOR-RR 62.8", rear axle 106.4", tail lights 144.8")
- Formboard pegs/nails + fender washers (loom guides every ~6")
- Masking tape + paint pen for landmark stations L01–L30
- Spring clamps (door-boot and grommet mock points)

## C. Labels + protection (prototype phase)

Per the heat-shrink stack protocol (`research/2026-05-21_milspec_heatshrink_protocols.md` — read before any termination):

- Printed heat-shrink label sleeves, 3:1, sized for 22–14 AWG bundles (circuit ID both ends, IPC/WHMA-A-620 style) — the label IS the circuit identity on a one-color loom
- Lacing cord (waxed polyester) — temporary bundle ties during prototype; no DR-25 until final
- DR-25 + SCL + solder sleeves: **do NOT order yet** — sizes follow final bundle diameters off the verified formboard; the research doc has the sizing stack ready

## D. Explicitly NOT on this list (locked deferrals)

- Connector bodies, terminals, seals, backshells, boots — after formboard verification (2026-05-11 lock; CONNECTOR_DATA_REPORT.md is ready for when that gate opens)
- Production color wire order — after step ③; the formboard CSV (`K5_wire_formboard_cuts.csv`) carries the color remap when it's time
- PDM30/M130 mating connector kits — already owned per K5_bom.txt (M130-CONN-KIT $35 listed; verify in hand before the gate opens)
