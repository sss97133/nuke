# Receipt: power steps without the AMP controller (candidate options)

- **Date:** 2026-09-30 (research 2026-09-29)
- **Change type:** research + options dictionary (`calc-data/catalog/options.yaml`). No registry, map row or database write.
- **Follows:** `receipts/2026-09-28_options-capacity-readiness.md` (the options mechanism), `receipts/2026-09-28_second-repair-pass-body-plugs-amp-dcdc-tailgate.md` (the AMP kit harness on the distribution stud)
- **Ask (owner, 2026-09-29):** "additionally I don't like seeing a power step we're gonna have to just bypass them figure out
  how to power differently which that has a lot of implications obviously computer"
- **Reading:** keep the AMP steps; drop the AMP controller and its kit harness; the MoTeC system powers and runs the motors.
  One line on the other reading: "I don't like seeing a power step" could mean no steps at all, but "bypass them ... power
  differently" says keep them.

## Pre-flight (wiring-receipt rule)

- **Read:**
  - state §1–4, including:
    - row 54 / `wiring_decisions` `locked-pdm-replaces-relays` (relays out);
    - rows 0v, 0ag and 0ah (engine PDM over CAN, the PDM15 flag, one 61-pin only; the sealed bay PDM32 is pending);
  - canon chapters 16 and 17;
  - the options file and options_v5.py;
  - the MoTeC PDM user manual (library extract);
  - the M1 hardware techspec;
  - IM75146;
  - `catalog/mounts.yaml` and `endpoints.yaml`;
  - the registry `capacity`, `m130_pinout` and PDM output map;
  - options-rd's merged add-on block (#416) and the fiberglass-top block (#420).
- **Every number is cited or marked unknown.** Web sources are saved to `reference_documents/web_snapshots/` (gitignored) with
  URL and fetch date.
- **Stopped on owner calls:** the speed threshold, one-door-both-steps vs per-door, the disable switch, purchases.
- **Deferred to the builder:** the motor-end splice and pull-down terminations, mounting spots, lengths (formboard / twin).

## What was built

- `docs/wiring/research/2026-09-30_power-step-bypass.md`:
  - motor facts and the stock controller's behaviour, sourced;
  - why a PDM can't reverse a motor;
  - two drives;
  - the gauge table from the canon;
  - the logic in PDM Manager terms;
  - the failure table;
  - the computer ledger;
  - the recommendation, the owner questions, and drafts for Haltech, AMP and Dave (not sent).
- `calc-data/catalog/options.yaml`, three **candidates**, placed after STEPS. STEPS stays decided and untouched.
  - `STEP-DCMD` (recommended; the Haltech pick is **provisional until the bench test** below): the bay PDM drives two
    Haltech HT-038009 DCMD bridges in the engine bay. The bay PDM is the PDM15 per the registry: OUT8 for bridge power, OUT10
    and OUT12 for the direction lines. 14 planned wires; removes 3, STEP_GND, STEP_DOOR_L, STEP_DOOR_R, AMP-STEP-CTRL,
    AMP-KIT-RING. Its first limit line is the lead's: "Bay PDM per the registry; if the bay box becomes a sealed PDM32 (state
    row 0ah, pending), these outputs remap in that registry pass."
    - Revisions, 2026-09-30:
      - Rev 2 moved it to the bay PDM32 candidate.
      - Rev 3 (lead) returned it to the registry. Candidates follow the registry, and the PDM32 swap is a pending owner
        decision, so it is not recomputed against a PDM32.
  - `STEP-RQ` (`alternative_to: STEP-DCMD`, `conflicts_with: [PW, PL, TOP-LIGHT, COM]`): PDM30 OUT3 + OUT21 (+ OUT4 per door) plus
    one Roboteq SDC2160 in the cab. 10 planned wires, 2 floor clamps, one MicroBasic script.
  - `STEP-SW`: a step disable switch on PDM30 DIG16 (or a CANKEY button). 2 planned wires.
  - New keys, documented in the block's header: `demand.removes`, `demand.outputs` / `inputs`, `demand.pdm15_outputs`,
    `requires_one_of`. options_v5.py on main ignores them. The wheel-speed lane's #426 teaches it to count
    `demand.pdm15_outputs`. options-rd offered to count
    `removes` in options_v5; not needed until a candidate becomes a decision.

## Facts found (the load-bearing ones)

| Fact | Source |
|---|---|
| The K5 kit is Far From Stock's "SquareBody Chevy 73-87 Amp Research Power Folding Step Kit" (K5 Blazer/Jimmy style), "various modified Amp parts", "both steps lower when opening either door" | web_snapshots `farfromstockstore.com__sqaure-body-chevy-73-86-amp-research-power-folding-step-kit.md`; DB `invoice_learned_pricing` 641c499e-6bac-420d-aef6-5db251294a5f (part number null) |
| AMP part number in the kit: **unknown** (no purchase record; Gmail has marketing only) | DB + Gmail search, 2026-09-29 |
| Motors are window-lift type (Siemens named); Siemens replacement 80-03129-90 discontinued; Brose 80-04868-90 | US 7,163,221 B2; electricstep and ampstep snapshots |
| 12 V, two-pin plug, orange/white and orange-black/white-black leads | AMP troubleshooting guide Test 3, p.5 |
| Controller reverses polarity, 5 s window, 30/40 A fuse | troubleshooting guide pp.3, 5 |
| Stops on obstruction; foot-on-step hold; 2 s retract delay; ground = deploy | IM75146 pp.10, 12; troubleshooting guide pp.4, 6 |
| Running and stall currents: **unknown** (not published; a third-party blog's "3 to 5 amps ... 15+ amps" is not used) | — |
| PDM outputs are high-side only; Output 9's ground path is a braking pulse | MoTeC PDM manual pp.6, 8, 22, 36 |
| M130 half-bridges: all six used; HS 9 A min, RMS 4 A | registry `m130_pinout`; M1 techspec p.11 |
| No MoTeC or Ecumaster product has a motor bridge | motec.com.au category snapshots; Ecumaster PMU manual |
| Haltech DCMD: "8A Continuous Per Channel, Maximum Transient Current 30A" (QSG p.3); 8–18 V; −40 to +85 °C; "Control is Active State: Low. 0V on Control A = 0V on Motor A. Pull Up Resistor not required" (QSG p.10); **input thresholds, impedance and pull-up value not published**; $180.00 (product page, 2026-09-29) | Haltech product page + quick start guide pp.2–3, 10 |
| AMP motor cross-reference: 80-04868-90 (Brose) "NOT a replacement for SKU# 80-03129-90" (Siemens, discontinued); 80-04868-10 = "SIEMENS to BROSE Conversion Kit" | ampstep.com (two pages), electricstep.com |
| Stock controller timing: 5 s drive each way with the motor unplugged; 2 s delay before retract | troubleshooting guide Test 3 p.5; IM75146 pp.10, 12 |
| Roboteq SDC2160: 2 × 20 A (30 s) / 15 A continuous, current limit and stall stop per channel, DIN '1' = 3–30 V, non-condensing (cab only), $350 | Roboteq product page, SDC21xx datasheet v2.3, user manual v2.1 pp.22–23, 62, 91 |

## Measured (options_v5.py on a scratch copy; the registry in the repo is not rewritten)

| | main before | with these options |
|---|---|---|
| options | 49 | 52 (48 candidates) |
| PDM30 outputs the candidates would take | 8 (3 spare) | 8: STEP-DCMD takes none; STEP-RQ is an alternate, shown but not summed |
| PDM30 inputs the candidates would take | 3 (2 spare) | 4 (STEP-SW takes DIG16) |
| alternates listed | 12 | 13 (+ STEP-RQ) |

- STEP-DCMD's own take is PDM15 OUT8, OUT10 and OUT12, written in `demand.pdm15_outputs` / `outputs`. options_v5 on main
  counts only PDM30 demand for undesigned candidates; #426 adds the PDM15 line.
- On the PDM15 ledger:
  - 20 A outputs: 7/8 → 8/8.
  - 8 A outputs: 3/7 → 5/7, or 6/7 with the wheel-speed candidate's OUT14 (WSS-F2, PR #426).
  - A step per door adds OUT15, which makes 7/7.
- These outputs remap if the bay box becomes a sealed PDM32 (state row 0ah, pending).

## Proposed registry changes (not applied; for whoever lands a decision)

If the owner picks `STEP-DCMD`:
- **Retire** through a blocks link from the new decision row: wire 3, STEP_GND, STEP_DOOR_L, STEP_DOOR_R, endpoint AMP-STEP-CTRL.
- **Remove** `"3": [AMP-KIT-RING]` from the distribution-stud kit (endpoints.yaml).
- **DOOR-JAMB-L/R** keep #42/#43 only.
- **Add** endpoints DCMD-L, DCMD-R, SPL-STEPD-X, SPL-STEPD-Y and STEP-MOTOR-L/R (the kit's motor-plug pigtails).
- **Add** the 14 `STEPD_*` wires.
- **Set PDM15 limits:**
  - OUT8 ≤ 10 A (≤ 4 A per motor).
  - OUT10 and OUT12 at 1 A.
  - For a step per door: OUT15 as DCMD-R's feed at 5 A.
  - These remap in the registry pass if the bay box becomes a sealed PDM32 (state 0ah).
- **Add PDM15 CAN inputs:** the PDM30 input states (door L/R, RUN, START, DIG16), with the fail-safe timeout values in the
  research §8, and the M1 General stream vehicle speed.
- **M130:** "ECU Transmit" of the M1 General stream on.
- **mounts.yaml:** the AMP-STEP-CTRL entry is replaced by DCMD-L/R entries.

## Substrate inconsistencies surfaced (not fixed here)

1. Registry `#66` fuel pump sits on PDM15 OUT5 (a 20 A output), while state row 0o says "#66 14 AWG from a PDM 8 A output".
   If the 0o reading is right, OUT5 is a spare 20 A output. It would give STEP-DCMD a second feed, for more than 4 A per
   motor or a step per door, without using OUT15.
2. `chapters/01-workshop-model.md` ("+8A peak draw per step during deploy") and `calc-data/pdm_power_budget.md`
   (OUT9/10/11 for the AMP steps and controller) carry unsourced AMP step currents. Neither is used here.

## Bench and tape items (gate the Haltech pick; nothing is bought before them)

| # | Item | Method | Sets |
|---|---|---|---|
| B1 | Motor **running current**, both directions, on its linkage | one motor, 12 V supply or the truck battery, DC clamp meter or a logged shunt | motor-lead gauge (research §7), OUT8 limit (≤ 10 A = up to 4 A running per motor; above that a second feed), DCMD fit (8 A continuous) |
| B2 | Motor **stall current** held against each end stop, under 1 s | same, the step held at the stop | I_stop threshold, DCMD transient fit (30 A), feed limit check |
| B3 | **End-of-travel current rise**: current against time through a full stroke into the stop | logged shunt or clamp meter with logging | t_blank (inrush), I_stop, t_confirm, t_min |
| B4 | **Travel time** deploy and retract | stopwatch or the same log | T_max (≤ 5 s), t_min |
| B5 | **DCMD input**: does Motor A follow Control A with a pull-down, and what value | 12 V supply as the "PDM output", resistor decade to ground, meter on Motor A | the pull-down value; confirms the inferred high state (research §5) |
| B6 | Motor plug housing and the kit harness lead gauge | read the parts | the motor-end splice size (M81824/1-2 or /1-3) |
| B7 | The DT mating plugs' E-seal (C015) part numbers for the DCMD's 4-pin and 2-pin, and the 18 AWG /32 control branches | Deutsch catalogue (state row 0ai: E-seal numbers not on file) | seals on thin-wall Tefzel |
| T1 | Motor-lead and feed lengths | harness-cad twin polyline, then tape on the truck | the voltage-drop check in research §7 |

## Unknowns (execution is blocked until each closes)

| Unknown | Needs |
|---|---|
| Motor running current, stall current, travel times | bench session: one motor on its linkage, 12 V, DC clamp meter, both directions, held at each stop < 1 s |
| DCMD control-input pull-up (so the pull-down value), 12–14 V input rating, case sealing | bench check with a meter, or Haltech (draft in research §11) |
| Roboteq Power Control pull-down value | Roboteq support, or read < 1 V with the feed off |
| AMP part number in the FFS kit; Siemens or Brose motor; motor plug housing part number | the carton or motor label, or a photo |
| Motor-lead and feed lengths | harness-cad twin polylines (asked 2026-09-29); the only number on file is 11.5 ft PDM30 → step motor (cut list v4.2 zone estimate) |
| The speed threshold S_max; one door both steps vs per door; the disable switch | owner |
| PDM logic sampling rate (stop latency) | bench log of OUT8.Current during a stall stop |
| The bay box: the PDM15 per the registry; a sealed PDM32 is pending (state 0ah; mounts.yaml flags the PDM15's unsealed case) | owner / Dave. If it changes, STEP-DCMD's outputs remap in that registry pass; if the bay PDM moves to the cab, the bridges move with it |

## Coordination

- **options-rd:** told the steps need no door cavities, the jamb splices go away, and which outputs and inputs each candidate
  takes.
- **harness-cad:** sent the bridge and controller positions and the runs to route.
