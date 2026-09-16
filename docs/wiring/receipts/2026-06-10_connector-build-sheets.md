# Receipt: Connector Build Sheets (D38999 bulkhead + M130 A/B + PDM30)

- **Date:** 2026-06-10
- **Change type:** artifact-generation + decision-recording
- **Agent:** Claude (connector-build-sheets session)
- **Scope:** `scripts/generate_connector_build_sheets.py`, `docs/wiring/output/connector-sheets/*`, `package.json` (`wiring:connector-sheets`), `K5_WIRING_STATE.md` §1

---

## 1. DECISION RECORDED: D38999 61-way firewall bulkhead is CONFIRMED

**Skylar's 2026-06-10 instruction to build connector build sheets for the firewall bulkhead
makes the D38999 61-way bulkhead a CONFIRMED architectural decision.** This supersedes the
2026-05-11 connector-deferral rule ("connectors are deferred until after formboard layout")
**for THIS connector only**. Device-end connectors (sensor pigtails, lamp sockets, switch
terminals, etc.) remain deferred per the original instruction.

This also answers open architectural question §3.1 (engine↔body harness boundary): the
join is a **serviceable milspec bulkhead connector at the firewall**, not a grommet splice —
for the 61 circuits that fit (see §4 over-capacity below). Direct-feed wires still use
grommets H1–H4.

### Verified part numbers (CONNECTOR_DATA_REPORT.md §1)

| Item | PN |
|---|---|
| Firewall receptacle (jam nut, socket insert) | **D38999/24WJ61SN** |
| Engine-loom plug (pin insert) | **D38999/26WJ61PN** |
| Socket contacts (receptacle) | M39029/56-351 (#20, 20–24 AWG, 7.5 A) |
| Pin contacts (plug) | M39029/58-363 |
| Crimp | M22520/2-01 (AFM8) + AS81969 insertion tools |

**ORANGE FLAG — stale PN:** `harness_spec_latest.txt` (2026-04-13) calls the bulkhead
"**D38999/26WA98SN**". That PN is malformed: `/26` is the *plug* (not a panel receptacle),
shell `A` = size 9 (max ~4–6 contacts, cannot hold 61), and "98" is not a 61-way insert
arrangement. Superseded by the verified PNs above. Spec PN should be corrected at next
harness-spec regeneration.

### Verified insert arrangement (citation)

**MIL-STD-1560 insert arrangement 25-61**: 61 × size #20 contacts, service rating I,
shell size 25. Verified against MILNEC *"TX Series / MIL-DTL-38999 Series III Insert
Arrangements"* — <https://www.milnec.com/mil-d38999-connectors/d38999-contact-arrangements.pdf>,
p. B-20 (selection table row "25-61 / J / 61 / hermetic-avail / I / 61×#20") and p. B-22
(insert arrangement drawing, front face of pin insert). Downloaded + verified 2026-06-10.

- Cavity designators: **A–Z (skip I, O, Q — 23) + a–z (skip l, o — 24) + AA–PP (skip II, OO — 14) = 61.**
- Geometry: five concentric rings, **PP at center**, ring populations ≈ 1 / 6 / 12 / 18–19 / 23–24
  (the catalog drawing fudges a/b slightly outward). The task brief's "1/6/12/18/24" hint is
  the idealized hex-pack; the lettered layout was transcribed coordinate-by-coordinate from the
  MILNEC drawing (blob-extraction), not modeled.
- The sheet draws the **receptacle socket face as seen from the engine side** = mirror of the
  pin-insert drawing. Master keyway (N position) at 12 o'clock. Verify molded designators on
  the insert face before pinning.
- NOTE: the local file `docs/wiring/reference/d38999_61pin_insert_arrangement.png` referenced
  by CONNECTOR_DATA_REPORT.md §1.2 **does not exist on disk** — its ring counts (17/13/11)
  also disagree with the MILNEC drawing. The MILNEC PDF is the citation of record.
  CONNECTOR_DATA_REPORT §1.2 needs a substrate correction (separate receipt).

---

## 2. Artifacts produced

| File | Content |
|---|---|
| `scripts/generate_connector_build_sheets.py` | generator (stdlib only; parses `K5_cut_list_v4.txt` at runtime) |
| `docs/wiring/output/connector-sheets/K5_connector_FIREWALL_D38999.svg/.png` | Sheet 1: 61-cavity face (mirrored socket view) + full cut-list table |
| `docs/wiring/output/connector-sheets/K5_connector_M130A.svg/.png` | Sheet 2: 34-way Superseal face (9/8/8/9) + pin table |
| `docs/wiring/output/connector-sheets/K5_connector_M130B.svg/.png` | Sheet 3: 26-way Superseal face (7/6/6/7) + pin table |
| `docs/wiring/output/connector-sheets/K5_connector_PDM30.svg/.png` | Sheet 4: PDM30 A+B faces + 30-channel table w/ pin pairs |
| `docs/wiring/output/connector-sheets/K5_connector_build_sheets.pdf` | 4-page merged print PDF |
| `package.json` → `npm run wiring:connector-sheets` | regenerate SVG + PNG + PDF |

Superseal face row-splits (34 = 9/8/8/9, 26 = 7/6/6/7) cited to the TE Superseal 1.0 catalog
configuration drawings (Dalroad mirror, p. 81); pin numbers sequential per MoTeC M130
datasheet (Part 13130) p. 4–5 tables, with on-sheet instruction to verify molded cavity
numbers before pinning. PDM30 pin→function map per PDM30 datasheet (Part 14103) via
CONNECTOR_DATA_REPORT §2.5.

---

## 3. Cavity assignment rules (as printed on sheet 1)

- **R1 SEED:** the 2026-04-13 `harness_spec_latest.txt` "BULKHEAD PIN ASSIGNMENT" pins 1–54
  map to designators in MIL-STD-1560 order (1=A … 23=Z, 24=a … 47=z, 48=AA … 54=GG). A wire
  keeps its seeded cavity iff it (a) still exists in cut list v4 (label-matched — spec W#s
  do NOT equal v4 wire #s), (b) still crosses the firewall per `K5_wire_paths.yaml`
  (path reaches an engine-bay landmark L02–L15), and (c) is 20–24 AWG.
- **R2 GAUGE GATE:** #20 contacts accept **20–24 AWG only** (CONNECTOR_DATA_REPORT App. A:
  18 and 16 AWG = oversized). Crossing wires outside that range → DOES-NOT-PASS / DIRECT-FEED
  block (grommets H1–H4). This is stricter than the task brief's ">16 AWG" line, on the
  authority of the data report's wire-range table.
- **R3 FILLS:** new v4 + companion wires fill freed/spare cavities in run-critical priority
  order, each taking the nearest free cavity (face geometry) to its parent signal's cavity.
- **R4 SHIELDED:** CKP/CMP/knock conductor-2 + drain get cavities adjacent to their signal
  (the shielded cable crosses as a unit: signal + cond-2 + drain = 3 cavities each).
- **R5 PAIRS ALL-OR-NOTHING:** a 3-wire sensor's gnd+5V companions are useless split; a
  complete single-wire circuit outranks half a pair for the final cavities.
- **R6 OVER CAPACITY:** see §4.

### Seed reconciliation (stale → v4)

Kept 42 of 54 seeded positions. Freed 12:

| Cavity | Seed (2026-04-13) | Why freed |
|---|---|---|
| B | Electric Water Pump | v4 #25 = 14 AWG → direct feed |
| W / X | Radiator Fan 1 / 2 | v4 #21/#22 = 12 AWG → direct feed |
| Y | Heater Blower | v4 #51 = 10 AWG → direct feed |
| Z | Horn | v4 #48 = 16 AWG → direct feed (R2) |
| b | Wiper Motor | v4 #49 = 18 AWG → direct feed (R2) |
| e / f | LED Headlight L / R | v4 architecture: dimmer legs #85a/b, #86a/b = 16 AWG → direct feed |
| p q r s | Polarity Reversing Relays 1–4 | circuits **deleted** in v4 |

Other stale-seed notes: spec's single 18 AWG ETB wire is now six wires (#4a–#4f, GM 12605109);
A/C clutch moved PDM OUT18→OUT16 and 14→20 AWG; spec W105 "camera on B02" already flagged
stale in v4 (#97 = PDM30:OUT15).

### Fill assignment (computed, deterministic greedy nearest-free)

B←#4b · e←#4e · f←#4f (ETB) · JJ←#99g · KK←#99s · NN←#99r (CKP, adj. to x) ·
HH←#101g · b←#101s · Z←#101r (CMP, adj. to v) · LL←#103g · PP←#103s (K1, adj. to AA) ·
MM←#104g · p←#104s (K2, adj. to BB) · q←#108g · r←#108r (MAP, adj. to CC) ·
s←#109g · Y←#110g · W←#113g (AT grounds) · X←#95 (iBooster relay, last cavity).

**Final count: 61/61 used, 0 spare, 8 overflow, 15 direct-feed rows.**

---

## 4. ORANGE FLAGS / conflicts found

1. **OVER CAPACITY — decision required.** 77 candidate firewall crossings (32 engine signals +
   19 companions + 24 body/front circuits + 2 power rails) vs 61 cavities. The 2026-04-13 seed
   fit at 54/61 only because it predates the accepted 2026-05-14 companion-wire addendum
   (Option B individual home-runs). **8 wires got NO cavity (OVERFLOW):**
   #102g/#102r (OPS gnd+5V), #112g/#112r (FPS gnd+5V), #100 VSS, #60 "ECU" power,
   #114/#115 Dakota senders.
   → Consequence as drawn: **OPS (cavity DD) and FPS (cavity y) have signal cavities but dead
   sensors** until resolved. Resolution options (Skylar's call):
   (a) consolidate 5V-ref and 0V-return rails at engine-side splices (1 cavity per rail frees
       ~8 — conflicts with the Option B home-run decision, so needs explicit re-decision);
   (b) second small bulkhead (e.g. D38999 size 11–13) for overflow + Dakota;
   (c) route overflow through grommets as sealed mini-splices.
2. **#INJ_PWR / #COIL_PWR (16 AWG, ENGINE-CRITICAL) cannot pass a #20 contact.** They are in
   the direct-feed block, but unlike fans/blower they have no decided grommet/fuse plan and no
   PDM channel yet (TBD since 2026-05-14 addendum). Engine will not run without them.
3. **Stale PN** `D38999/26WA98SN` (§1 above).
4. **No M130 power/ground wires exist in cut list v4**: BAT_POS A26 and BAT_NEG A10/A11 have
   no wires; #60 "ECU" (22 AWG, MISC) is semantically unclear (YAML routes it M130→BAT as
   "ECU Power" — 22 AWG is implausible for an ECU feed). Flagged on sheets 1+2.
5. **#100 VSS substrate inconsistency:** 2026-04-13 spec routes VSS underbody (no bulkhead);
   `K5_wire_paths.yaml` routes it via engine valley (L02 → crosses). In OVERFLOW pending route
   decision.
6. **`K5_wire_paths.yaml` labels for #75–#93 are stale** vs v4 (e.g. YAML "77" = "Side Marker
   Right Front" vs v4 #77 = "Side Marker Rear Left"). Crossing determination used v4 labels +
   front/rear topology; needs a separate substrate-correction pass.
7. **#62 CAN / #61 PDM-power:** YAML comment claims they "cross the firewall," but every CAN
   node and the PDM are cab-side — they do not cross and got no cavity. YAML comment stale.
8. **B03/B04 CLT/IAT conflict** (pdm_power_budget vs cut list v4 + appendix-G) carried forward
   from the pinout sheets — cut-list value shown, still orange on sheet 3.
9. **16/18 AWG crossing wires** (#48 horn, #49 wiper, #85a/b, #86a/b) were SEEDED into the
   bulkhead by the 2026-04-13 spec but physically cannot crimp into #20 contacts — moved to
   direct feed. If they should pass the firewall in a connector, the fix is a second insert
   with #16 contacts, not forcing the crimp.

---

## 5. Unknowns

| Unknown | Needs |
|---|---|
| Overflow resolution (8 wires) | Skylar decision: consolidate rails / second bulkhead / grommet splices |
| #INJ_PWR / #COIL_PWR PDM channels + crossing method | channel assignment + grommet/fuse plan |
| #94 / #95 PDM channels | channel plan amendment |
| #105 / #111 M130 UDIG pins | pin assignment (B08–B11, B14 free) |
| #98 fuel level AV pin | AV6 (B20) is the open candidate |
| M130 power/ground feed wires | add to cut list (A26 BAT_POS, A10/A11 BAT_NEG) |

Execution of the SHEETS is not blocked by these — they are printed orange on the sheets
themselves, which is the point of a build document: the builder sees every open hole at the
bench.

**Trigger question for Skylar:** the 61-way is full and 8 circuits are homeless — consolidate
the 5V/0V rails at engine-side splices (cleanest, frees 8+), add a second small bulkhead, or
grommet the overflow?
