# Receipt: the removable fiberglass top — disconnect, solar, lighting, cameras, finish (candidate options)

- **Date:** 2026-09-30 (written 2026-09-29, lane top-design)
- **Change type:** research + catalog. Seven CANDIDATE options were added to `calc-data/catalog/options.yaml`, with 50 planned wires
  in their `adds`. Research: `research/2026-09-30_fiberglass-top-disconnect-solar-lighting.md`.
- **Follows:** `receipts/2026-09-28_options-capacity-readiness.md` (option format) and
  `receipts/2026-09-29_owner-calls-one-61pin-at-fusebox-hole.md` (only the 61-pin crosses the firewall; any other connector is round).
- **Ask (owner, 2026-09-29):** "we need a really cool disconnect if we're gonna be running anything on the fiberglass top so the
  cargo lights ... dreamed of doing solar panel install should be crazy and the problem is probably we had to run fat ass wires to
  it ... we need to actually do like the lighting design ... how do we finish the roof doing insulate it or delete it raw ... do we
  put any cameras or anything in it"

## Pre-flight

- **Read first:**
  - state §1–4
  - canon ch.16 §1.8, §2.3, §2.4, §3, §5, §7; ch.17 §17.1, §17.2, §17.8, §17.9; ch.18 §3, §6, §8
  - the power-spine study §1.3
  - the lamp-socket and unpicked-parts research files
- **Library searches:** "removable top" and "dome lamp" gave the 1977 LTSM PDF p.155 and p.838, the 1987 LDTSM PDF p.1363–1364,
  ST-352-78 foldout A-1 and the RPO list p.69.
- **Citations:** every number carries a source or is marked unknown.
- **Stopped at these owner calls** (they are open questions in the research, §6):
  - where the YellowTop lives
  - PDM15 in the cab or in the bay
  - whether the top is off in summer
  - solar look, finish, keypad
  - clearance-lamp count
  - top camera yes or no
- **Deferred to the builder:** rack mounting, the pillar plate, cavity letters, final lengths and the connector insert (ch.18 §6, §8).

## What was added (all candidate)

| Code | What | New PDM30 outputs / inputs | Top cavities | Planned wires |
|---|---|---|---|---|
| TOP-DISC | D38999 Series III 17-26 at the lower rear pillar, the lamp-return pair | 0 / 0 | 2 (return) of 26 | 6 |
| TOP-SOLAR | 235 W 72-cell rigid panel on a rack; SmartSolar MPPT 75/15 beside the YellowTop alongside the Orion; 16 AWG PV, 10 AWG battery pair | 0 / 0 | 4 | 14 |
| TOP-LIGHT | CHMSL and cargo lamp moved onto the top; 2 × Baja S1 work/scene lamps on OUT21 | 1 (OUT21; **conflicts with PL**, which names it too) / 0 | 3 | 12 |
| TOP-LIGHT-SIDE | 2 × Truck-Lite 81335C side scene lamps on their own output | 1 (proposal: a cab-side PDM output that doesn't exist; not buildable as the registry stands) / 0 | 1 | 8 |
| CANKEY | MoTeC 8-button CAN keypad | 0 / 0 | — | 4 |
| TOP-CAM | EchoMaster PHD5N1 rear high-mount camera on VS41 input 1 | 0 (taps OUT23) / 0 | 4 | 6 |
| TOP-FINISH | butyl + thermal layer + removable panels, harness in the rib channels | 0 / 0 | — | 0 |

The format follows options-rd's PR #416 block (`product`, `requires`, `demand.taps`, `demand.limits`, `demand.adds`) so the two
blocks merge mechanically. `top_cavities` is informational; neither version of `options_v5.py` sums it.

## Measured (options_v5, 2026-09-29)

- **Before PR #416 merged (dry run on main's `options_v5.py` + this block):**
  - 22 options
  - candidates would take 7 PDM30 outputs against 3 spare
- **After rebasing on #416 + #417 (the run committed here):**
  - 39 options, runs clean
  - candidates would take **7 PDM30 outputs against 3 spare** (5 before this block) and **3 PDM30 inputs against 2** (unchanged;
    these add none)
  - buildable harness unchanged at 361 wires
  - the alternates line lists only options-rd's alternates; this block adds none
- **Sizing:** from the canon rules (research §2.4, §3.2).
  - PV: 16 AWG (1.1–2.3 % of Vmp).
  - MPPT battery pair: 10 AWG on a 20 A fuse.
  - Work-lamp feed: 16 AWG body run (0.38 V, 2.7 %). All-20 AWG fails at 4.0 %.
  - OUT21 set at 4 A; lamp return 16 AWG.
  - Every limit clears the 0.85 × pin-lead and contact ratings.
- **Regenerated:** `OPTIONS.md` and `k5_registry.json` (options, readiness and capacity) by `options_v5.py`, after #416 merged.
  The manual (`manual_v5.py`, page 1-5 Specifications) was not rebuilt. Next full run goes in the usual order: reconcile, then
  check --wires, then options, then manual.

## Substrate inconsistencies surfaced (not fixed inline)

1. **State §1 row 42 says "K5 insulation = COMPLETE (roof, firewall, floor)".**
   - The owner's words were "I've already insulated the vehicle" (receipt 2026-05-23).
   - The photos lane (2026-09-29) found bare fiberglass under the top (2021-06-12) and bare steel under the cab roof (2024-10 to
     2024-12). The Kilmat it found was only on the cargo-tub walls (2026-01-31 and 02-01).
   - Proposed substrate correction: the lock covers the cargo-tub walls (and whatever else the owner confirms). The top is not
     insulated.
2. **`mounts.yaml` CLEARANCE-L/C/R says "The K5 has a removable top: where on it the lamps sit is not set."**
   - The 1977 K5's front roof is steel (1977 LTSM PDF p.155), so the clearance lamps belong on the half-cab roof and never touch the top.
3. **Truck-Lite 80251C:** the listing title says "2"x13"" but its dimension table gives 18.19 × 5.75 × 1.08 in.
4. **ORACLE 4514-003:** the same page gives 6 W and 0.15 A, which don't agree. The registry uses 0.5 A.
5. **`objectTraits.ts` has no trait for the removable fiberglass top.**
   - `Exterior_Roof` is the steel roof.
   - Under the wiring-receipt rule this is a routing blocker. A trait entry is proposed in research §5.3; it's a frontend data change
     for the lead.
6. **Registry #93 and #74 route as "cab exit: through the body to the outside (path not recorded)".**
   - On the top they would stay inside the body to the rear pillar and then cross TOP-DISC.
   - That split (13 ft body + 5.5 ft top of the 18.4 ft zone estimate) is in TOP-LIGHT's adds, not in the registry.

## Open unknowns (each with its close path)

- **Top geometry:** flat roof size, crown, rib spacing, pillar section, where the pigtail lies. Tape item T-15 (wiring/geometry, PR #417).
- **The top's weight:** weigh it; it bounds the rack and panel.
- **YellowTop location:** owner (asked 2026-09-29). It moves the MPPT and the PV length (4 ft or 13 ft on the body side).
- **PDM30 OUT21:** TOP-LIGHT and PL both name it, and it is the only spare 8 A output. Owner call.
- **One more cab-side output:** a second body PDM (owner's multiple-PDM direction, state §1 row 55) or the PDM15 moved to the cab
  (mounts.yaml; the registry has it in the engine bay). Without one, TOP-LIGHT-SIDE can't be built, and neither can TOP-LIGHT with
  PL. Owner or Dave.
- **Currents to measure:** EchoMaster PHD5N1 (not published), and the MoTeC keypad's current and plug (MoTeC documentation).
- **Lamp data:**
  - Baja S1 work/scene lumens: the maker page refused the fetch.
  - Truck-Lite 81335C IP rating: not on its page.
- **Parts not picked:** the PV 2-pole breaker (above 57.4 V DC), the sealed 20 A fuse holder for 10 AWG, and the roof gland.
- **Amphenol D38999/20WE26PN and /26WE26SN:** whether contacts are included isn't stated on DigiKey.
- **Deadener weight:** not published on Dynamat's page. Weigh a sheet.

## Lanes

- **options-rd:**
  - owns FC and MIRD; this camera goes on VS41 input 1; OUT23 group at 1.91 A before VS41 and this camera
  - options-rd claims no PDM30 spare
- **pieces:** flagged that OUT21 is PL's in the ledger and that the PDM15 is in the bay. Both are now explicit: `conflicts_with: [PL]`
  plus a CONFLICT limit on TOP-LIGHT, and PROPOSAL wording on TOP-LIGHT-SIDE.
- **geometry-scan:** T-15, dimensions.yaml.
- **photos:** evidence for §0 and §5.1.
- **nav-comms:** Starlink Mini and antennas on the steel roof, nothing through TOP-DISC; 4 spare cavities held for a top-mounted dish.
- **harness-cad and parts-artist:** sent the part dimensions (connector, boot, stowage, panel, MPPT, lamps).
