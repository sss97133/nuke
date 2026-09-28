---
id: 2026-09-26_substrate-correction-1977-neutral-start-switch-on-column
date: 2026-09-26
change_type: substrate_correction
scope: receipts/2026-05-17_k5-steering-column-wiring-identification.md §6; receipts/2026-05-17_ignition-switch-trq-swa77344-research.md TL;DR item 2
status: FILED (prior receipts left untouched; this receipt supersedes the two claims below)
---

# Correction — the 1977 C-K automatic neutral-start / back-up lamp switch is ON THE STEERING COLUMN

## Claims being corrected
1. `2026-05-17_k5-steering-column-wiring-identification.md` §6: "Park/Neutral/Reverse/Drive position electrical signals come from a neutral safety switch + back-up light switch on the transmission case itself, not the column. The factory K5 used the TH350/TH400 case-mounted neutral safety switch."
2. `2026-05-17_ignition-switch-trq-swa77344-research.md` TL;DR 2: "PRNDL gating in 1977 is mechanical, not electrical."

## What the 1977 Light Truck Service Manual says (`reference_documents/k5_factory_docs/1977_Light_Truck_Service_Manual.pdf`)
- PDF p796–797, Section 8 "NEUTRAL START SWITCH REPLACEMENT — C-K Models (Fig. 8-12)": "Assemble the switch to column by inserting the switch carrier tang in the shift tube slot and fasten in position by assembling mounting screws to retainers." Fig. 8-12 shows the C-K switch on the STEERING COLUMN. Only the **G and P** models use a "Transmission Mounted Switch."
- PDF p797: "BACKING LAMP SWITCH — See 'Neutral Start Switch' for automatic transmission models." The same column switch runs the back-up lamps.
- PDF p783 (back-up lamp diagnosis): "check switch terminals in back-up position with test lamp. If lamp lights at pink wire terminal but not at light green wire terminal, replace neutral start switch." So the feed is pink and the back-up lamp output is light green.
- PDF p717 (Section 7A): the neutral start / back-up lamp switch "must be adjusted so that the car will start in the park or neutral position, but will not start in the other positions ... refer to Section 8."
- 1978 ST-352 circuit tabulation (`reference_documents/wiring_diagram_booklets/ST_352_78_CK_Wiring.pdf` p8): circuit #5 Yellow = "Neutral Safety Start Sw. or Start Relay Feed."

## Why it matters now (6L90 + PCS TCM-2650)
The column switch tracks the **column lever**, not the 6L90's manual valve. Whether its P/N/R windows line up with the 6L90 detents depends on the shift-cable adapter, which is unverified. The PCS TCM-2650 can output neutral-safety and reverse-light **grounds from the transmission's own lever position**. Source: ZGP "TCM2650 GM 6L 8L Configurable Tuning Instructions" rev 2, p19–20, "PWM vs. Lever Position ... typically used for Neutral safety and Reverse Lights. This outputs a ground only." This doc is in the vendor Dropbox sent with Zero Gravity order #9501 (Gmail 2024-09-11).

## Proposal (owner/Dave call, not applied)
Delete the column NSS function. Crank-enable and reverse lamps come from the PCS lever-position outputs into PDM30 inputs. The column switch can stay in place, unwired, or be removed.

## Open unknowns
- Whether the K5's existing column still has the switch and its connector. Needs: a photo under the dash at the column base.
- The PCS harness wire colors for the lever-position outputs. The guide cites "the harness drawing" (p7), which is not in the Dropbox. Needs: the ZGP harness drawing, or photos of the harness labels.
