---
id: 2026-09-26_dave-sheet-alignment-22awg-m22759-16-dossiers
date: 2026-09-26
change_type: substrate_correction + substrate_extension
amends: 2026-09-26_device-ends-from-owner-parts-and-motec
supersedes: K5_WIRING_STATE §1 row "12–22 AWG: M22759/32" (2026-05-11) for 22 AWG only; the 2026-09-24 Gemini adjudication "lock is /32 for 12–22 AWG" (receipt 2026-09-24_gemini-thread-distillation §3)
scope: docs/wiring/calc-data/{reconcile_v5.py, kits_v5.py, k5_registry.json, DOSSIERS.md, catalog/endpoints.yaml, catalog/tools.yaml}; chapters/16 §1.5; K5_WIRING_STATE §1 + 0p + §5; .claude/rules/wiring-wire-closure-protocol.md field 5
status: APPLIED (owner approved the pick-up plan ~/.claude/plans/vivid-hugging-globe.md, which carried "22 AWG → M22759/16, default adopt")
owner surface: Claude Doc "K5 Parts & Build Book" — main tab rev 128 (section "Sep 26 evening: write-ups, Dave's conventions, 22 AWG wire" + cart-change table; blower row corrected; as-of 2026-09-26) and the new "Plug write-ups" tab (14 plugs, generated from DOSSIERS.md by kits_v5.py dossier_md)
---

# Dave-sheet alignment, 22 AWG → M22759/16, and the cited write-ups

The session that did this work died with the laptop at ~16:05 on 2026-09-26, before committing. The work was on disk, and it rebuilds byte-for-byte from the scripts. It was reviewed on pick-up and landed here.

## Why
Owner, 2026-09-26 15:43: "the settle stuff does that match what you see in any of daves provided docs, like the bronco sheet that is a 61 pin example. the factory 4 seasons 1977 is replaced with a 1994 era blower. seen in our parts orders. so i guess yorue not citing the parts we have or youd caught that. the c125 is an lcd but i havent yet defined if we will be using an lcd from motec. … have we made real progress, change the cart and you should be able to show me fully cited depth per any points on the harness that are 100% solved"

## What changed

### (a) Sensor supplies and grounds follow Dave's sheet
Source: `~/Downloads/M130 ECU Overland Bronco.xlsx` (Desert Performance), Sensor Connections. It is an LS V8 install (GM a/b/c/d coils, 8 injectors), so its sensor-side conventions carry over. Its M130 I/O pin choices do not carry over (see the Gemini lesson in state §5).
- **Crank and cam:** 6.3 V from B19 (white/orange), 0 V on B15 (white/blue, "Ref Sync 0 volt").
  - Wires #99r, #101r, #101g, #99s, #101s.
  - MoTeC M1 techspec: B19 = SEN_6V3 sensor supply; UDIG inputs have a 3k3 pull-up and are "suitable for hall/optical".
- **Every other analog sensor:** 5 V from A2 (orange), 0 V on B16 (brown).
  - Wires #4f, #108r/g, #109g, #113g, #103g/s.
- **Pedal:**
  - Track 1 on A2/B16.
  - Track 2 on A9/B15, white/blue. A GM dual-track APP needs a separate 0 V per track.

### (b) Injector pins
- Pin 1 = M130 injector driver (white). Pin 2 = +12 V (red). Source: Dave's sheet ("injector 1 = fuel injector output (white), 2 = relay power (red)").
- The EV1 coil is not polarized, so this sets a convention, not a correction.

### (c) Blower #51
- **Motor:** the 4 Seasons 35587 actually ordered (A/C order 2026-09-24, eBay item 406732859496), not the 1977 factory motor.
- **No published amp rating** (Summit and CARiD pages, fetched via Firecrawl 2026-09-26). The wire is therefore sized to its protection:
  - a PDM30 20 A output;
  - 12 AWG /32 (MoTeC PDM manual: 14# = 22 A at 80 °C);
  - drop at 20 A over 1.7 m = 0.19 V (1.4 %).
- **Reference only:** the 1977 LTSM Sec. 1B factory blower, 12.8 A.
- **Open:** measure the installed draw on HIGH. It sets the PDM current limit.

### (d) 22 AWG = M22759/16-22 (114 active wires)
- **MoTeC's spec:**
  - `motec_c125_user_manual.pdf` printed p.20 (PDF p.21): "Use 22# Tefzel wire (Mil Spec M22759/16-22)".
  - The same manual, PDF p.71: "Wire to suit Display Logger connector: 22# Tefzel, Mil Spec: M22759/16-22".
  - `motec_pdm_user_manual.pdf` printed p.48 (PDF p.51), Wire Specification: "M22759/16".
- **Why the C125 is cited:** only for MoTeC's wiring practice on the same Superseal family. The owner has not decided on a MoTeC display.
- **Seal fit:**
  - /32-22 is 0.043 in = 1.09 mm OD (ProWire AS22759/32 datasheet, fetched 2026-09-26).
  - That is under the "Cable-Ø 1.20 – 1.85 mm" of GT150 22–20 terminal 12191818 (distributor technical data, fetched 2026-09-26).
  - /16-22 is 1.27–1.37 mm (ProWire M22759/16 datasheet).
  - XTRA Motorsport's Tefzel page states the same problem: "the thin ETFE wall gives M22759/32 a smaller OD than most OEM wire seal bores".
- **Scope:** 20 AWG and larger stay /32 (≥ 1.27 mm).
- **Gemini adjudication corrected:** the 09-24 note said /16 for signal wire was a Gemini error. Gemini's reason ("/16 is cross-linked") was wrong: /16 is extruded, /32 is cross-linked (canon ch.16 §1.1). But for 22 AWG the part itself was right.

### (e) `DOSSIERS.md` — 14 plugs written up field by field
Each field carries value, source and state (`cited` / `bench` / `deferred` / `open`).
- **Design-complete (8 as found; 6 after the seal check in (e2)):** coolant temp, oil pressure, crank, cam, CAN bus, PDM config port (XLR), M130 laptop port (RJ45), firewall plug (engine side).
- **One open item each (6):**

  | Plug | Open item |
  |---|---|
  | Throttle body | TE AMP crimper model |
  | Coils | kit terminal crimper |
  | Injectors | JPT crimper |
  | Knock | terminal family |
  | Pedal | housing match on arrival |
  | MAP | sensor not bought |

- **Field states across the 14:** 540 cited · 97 bench (strip length off the first contact) · 14 deferred (cut length, twist, sleeve grouping — formboard) · 6 open.
- **Correction made on pick-up:** the crank/cam descriptions said "5 V Hall". The supply is Dave's 6.3 V, so the text now reads "Hall".

### (e2) Seal-fit check on pick-up — crank and cam are NOT solved yet
The Metri-Pack 150 seal in the design, 15324976 (white), has a wire insulation range of 1.3–2.1 mm (ConnectorID CID1133, drop-in for Aptiv 15324976, via Firecrawl 2026-09-26).
- /16-22 is 1.27–1.37 mm (ProWire M22759/16 datasheet), so the seal is marginal at the thin end.
- The shielded cable's conductor OD is not checked yet.
- 15324974 (blue) seals 1.0–1.9 mm (ConnectorID CID1583, drop-in for Aptiv 15324974) and covers both.

Before swapping, confirm the blue seal fits terminal 12110847's seal crimp. The check is now an open item on CKP, CMP and MAP (`catalog/endpoints.yaml`).
- Result: **6 plugs design-complete** (coolant temp, oil pressure, CAN bus, PDM port, M130 port, firewall plug engine side).
- **8 plugs have open items** (crank, cam, throttle body, coils, injectors, knock, pedal, MAP).
- This corrects the "8 of 14" figure in the pick-up plan.
- GT150 plugs (12191818: 1.20–1.85 mm) and the D38999 #20 contacts take /16-22 without a seal question.

### (f) Cart change list, now generated
- `kits_v5.py` `cart_changes()` recovers the dead session's one-off script. The session transcript is 681fed60, 20:01 UTC.
- It writes `reg["cart_changes"]` and a KITS_REPORT section: remove 25 · add 28 · qty 3 · trim 1 · part lines 17.
- **Remove:** all 25 M22759/32-22 lines.
- **Add:**
  - the same colours in /16-22, each keeping its old footage when that is larger, and white at 1,000 ft prototype stock;
  - 18 AWG black ×20 and brown/black ×20;
  - 14 AWG black ×5.
- **Quantity changes:** 20 AWG red 40 → 50, 18 AWG red 40 → 55, 14 AWG red 12 → 30.
- **Trim:** 8 AWG red 30 → 10 ft (saves $81.28; the pump now runs 14 AWG, row 0o). The rule lists a line only when the unneeded feet cost ≥ $25.
- **Part lines:** 12110847/15324976 ×13, 68102 ×16, WCTHB50, 15326829 + 15317363, GT150-AIR-TEMP-KIT, LS-CRANK-CONN-KIT +1, 12191818/15366021 +3, D-609-05 +8, M-RJ45-CABLE, CPA-100-3/4-BK, CAN-TERM-100R, MS27488-20-2 ×8; remove 68212 and 68104.
- **It is a view, not an order:** the cart stays a reference and is rebuilt once from the finished list as a ProWire saved BOM. This was the owner-approved default ("sync the cart" overrides it).

## Cart state (unconfirmed)
- **Before the crash:** ProWire Q27156 was read back at 96 lines, $3,620.23 (matching `orders/prowire_Q27156_2026-09-26.json`).
- **The edits that followed:**
  - One UI click took 8 AWG red (M22759/16-8-2) from 30 to 29 ft, seen on screen.
  - The scripted quantity update after it was denied by the auto-mode classifier ("Real-World Transactions") and never ran.
  - The laptop died during the reload read-back.
- **Read-back pending:** on pick-up the Chrome extension was not connected (Chrome running, `list_connected_browsers` = []).
- **The snapshot JSON is unchanged.** The only known difference is the 29 ft on one line.

## Verification
- **Reproducible:** `python3 docs/wiring/calc-data/reconcile_v5.py` (calls `kits_v5.py`). Two consecutive runs gave byte-identical `k5_registry.json`.
- **Registry:** 174 active (5 retired), 243 candidate, 52 implied, 56 endpoints, 343 wire ends.
- **Pre-edit check:** the dead session's on-disk files rebuilt byte-identical on pick-up, before any edit.
- **Change list:** matches, code for code, the list the dead session printed (REMOVE 25 / SETQTY 3 / ADD 28 / PARTS 17). The trim line is new, and its value matches that session's stated intent ("8 AWG red, 30 → 10 ft").

## Unknowns (each with how it closes)
- **Striped /16-22 stock:** 11 of the striped /16-22 colours (42, 43, 46, 51, 52, 53, 56, 59, 93, 94, 96) are not on ProWire's "in-stock striped" page. At least /16-22-52 does show InStock on its own product page. Confirm each colour at BOM time, or remap it to a stocked stripe with a printed label (colour reassignment allowed, §1 row 2026-05-11).
- **Crimpers:** the crimper models for the WCTHB50 (TE AMP) and 68102 (JPT) terminals come from the TE PN on the terminal bag.
- **Knock terminals:** the 68201 terminal family is Metri-Pack 150 or GT150; both 22 AWG sets are in the design.
- **Blower draw:** measure on HIGH once fitted.
- **Cart read-back:** reconnect the Chrome extension, then read the cart (read-only).

## Addendum (same session): corrections found while publishing
Each fix is in the generator, not hand-typed into the doc.
- **Pull tests:** the firewall's size-20 M39029 contacts get their own minimums: 24/22/20 AWG ≥ 8/13/21 lbf (Checkline "Wire pull test standards", contact table: 36/57/92 N). That is higher than the generic 8/13 lbf the write-ups had used. 24 AWG (Ethernet) = 8 lbf, from the same sheet.
- **Injector +12 V branch:** lands on pin 2 per Dave. The label and `to` said pin 1 while the pin map said 2.
- **Knock sensors:** both carry the Metri-Pack seal-fit open item too (shielded-cable conductors into 15324976).
- **Generator cleanups:**
  - A missing colour no longer prints "None".
  - Two catalog sources that YAML split at commas are now quoted.
  - "in_cart" reads "in the cart".
  - The COIL/INJ/KNOCK "-1" write-ups list where their identical siblings land.
- **Result:** 6 of 14 plugs solved; open items on crank, cam, TB, coils, injectors, knock (2), pedal and MAP (2).
