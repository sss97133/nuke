# Receipt: second repair pass: body plug families, the amp power step-down, the DC-DC fuse, the tailgate key switch

- **Date:** 2026-09-28 (late night)
- **Change type:** catalog + registry (`reconcile_v5.py`, `cable_sizing_v5.py`, `catalog/*`) + checker (`check_plug_ends.py`, `kits_v5.py`) + pages; one migration shipped separately (#384)
- **Follows:** `receipts/2026-09-28_pin-tables-for-83-plugs-and-range-failures-closed.md`
- **Ask (owner, 2026-09-28):** "its not looking at if we arent in A tier or S tier.. those should be your indications to send off more repairs to the docs"

## Live database
Migration `20260929010000_harness_endpoints_family_new_families.sql` (PR #384, deploy run 36487775734 success) extends
`harness_endpoints_family_check` with dt, dtp, dtm, gm_blade, screw_terminal, contura. Read back from the live table with
`pg_get_constraintdef`: the six are in the list. `load_map_rows.py` now writes them instead of `unknown`.

## Decisions, each from a cited number
| item | was | now | source |
|---|---|---|---|
| Amplifier power and ground | #32 and AMP_GND 2 AWG straight into the amp plug (fails R1: JL's plug is 4 AWG) | 2 AWG run to a reducing block beside the amp (AMP-BLOCK); 4 AWG tails AMP_PWR_TAIL / AMP_GND_TAIL into the set screws | JL VX700/5i guide, Power Connector: "4 AWG is the required copper wire size for this amplifier"; spec table Min. Copper Power/GND Wire 4 AWG, Recommended Fuse 60 A; step A "install a fused distribution block near the amplifiers". The 18.4 ft loop needs 2 AWG for the 3 % drop (4 AWG drops 0.62 V = 4.4 %). 4 AWG under the MIDI 60: 72 A bundled × 0.85 = 61 A ≥ 60 A |
| Amp plug range | family screw_terminal 22–6 AWG applied to every cavity | per-cavity range from the maker (`range_by_wire`): power 4, ground 4, remote 18–10 | same JL spec table |
| DC-DC input fuse | MIDI 40 A (chapters/17: 35 A × 1.25 = 44 A rounded down, under the 125 % floor) | **MIDI 60 A**; 6 AWG carries it (75 A at 100 °C × 0.85 = 64 A) | Victron Orion-Tr Smart manual §4.2 Figure 6, 12 V row: external battery protection fuse 60 A, cable 10 mm² at 1–2 m |
| Speed-sender splice | two D-609-03 (26–20), one per wire | one splice per shared device lead, sized on combined circular-mil area: #100 + VSS_DAK = 2 × 640 CM → 18 AWG equivalent → **D-609-04** | ProWire 3137CT cavities 26-20 / 20-16 / 16-12 |
| Tailgate key switch | 4-wire series switch, no feed | parallel with the dash switch: FEED wire TG_KEY_FEED (circuit 60); cutout switch TG-CUTOUT in the UP line (TG_CUT_IN 183C, TG_MOT_A 183E); pin table puts TG_CUT_IN on CLOSE | 1978 C/K booklet p.16 (read by two agents independently) |
| Blower resistor | "3 prongs" | 4 terminals 51 / 63 / 72 / 101 | 1978 booklet p.16, p.8–9 |
| RADIO_REM | 20 AWG | 18 AWG M22759/32 | JL power plug: remote 18 to 10 AWG |
| HORN / LICENSE / UNDERHOOD grounds | — | note: factory grounds through the housing; the wire stays (no chassis-ground reliance, ch.17 §17.4) | pin tables |
| Body plug families | 43 of 48 open | gm_blade on 6 (wiper motor, blower resistor, blower motor, horn, tailgate motor, tailgate key switch); screw_terminal on DCDC (1.6 Nm, no ferrule) and AMP; new dtm family on WIDEBAND (LTC plug #68054, socket 0462-201-20141, HDT-48-00) | 1978 booklet p.13/p.16, 1977 manual p.803, Victron §4.2/4.4, JL guide, LTC manual p.32 |

## Measured (after `reconcile_v5.py` → `check_plug_ends.py` → `options_v5.py` → `manual_v5.py`)
| measure | end of #383 | now |
|---|---|---|
| wire ends checked | 831 | 839 (tailgate feed + cutout, amp tails) |
| any rule FAIL | 0 | **0** (4 surfaced mid-pass, all closed above) |
| every rule PASS | 396 | 395 |
| R1 range PASS / OPEN | 549 / 282 | 586 / 253 |
| engine-run set | 174 / 168 / 0 | 174 / 168 / 0 |
| buildable harness | 324 wires · L1 181 · L4 302 | 328 wires · L1 207 · L4 306 |
| book | 51 pages, 0 lint | 51 pages, 0 lint, every plug on a sheet (TG-CUTOUT on the tailgate sheet, AMP-BLOCK on the audio sheet and the DC primary sheet) |

## Open (named close paths)
- AMP-BLOCK part: a 1-in / 1-out reducing block ≥ 60 A, 2 AWG in, 4 AWG out, + and −.
- 2 AWG lug for #32 on the MIDI holder's M5 stud; 6 AWG M5 lug for DCDC_IN (810TP is 8 AWG).
- Tailgate key feed: factory was always-hot; ours shares PDM30 OUT1 on ignition RUN (owner call: key works only key-on).
- #32 / AMP_GND route engine bay → bed: the sheet stamps "crosses the firewall with no crossing cavity"; they run outside the cab, route not drawn.
- WIDEBAND contact range: vendor pages say "for 20 AWG" only; the Deutsch contact drawing sets it.
- 43 → 35 body plugs still open: lamp sockets (factory socket vs new pigtail + splice), parts not picked (CHMSL, cargo lamp, fan, fuel pressure sensor, A/C switches, 4WD switch), camera manual, fuel hanger plug, H4 blade order.
