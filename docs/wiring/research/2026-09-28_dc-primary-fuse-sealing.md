# DC primary fuses: sealed holders for the engine bay (2026-09-28)

Owner ask: "the 60a fuse needs to be hella element proofed." This is a research note and a pick. No purchase has been made, and no registry or catalog row has changed.

All maker data below comes from snapshots in `reference_documents/web_snapshots/` (gitignored), fetched 2026-09-28 through `calc-data/fetch_sources.py`.

## The fuses on the DC primary (from the wire rows, 2026-09-28)

| Circuit | Fuse (row) | Where | Cable | Cable end at the fuse (stud list) |
|---|---|---|---|---|
| #32 amplifier | MIDI 60 A | YellowTop + post | 4 AWG | not set |
| DCDC_IN | MIDI 40 A | distribution stud | 8 AWG | 810TP (#10 / M5) |
| #52 iBooster | MIDI 40 A | distribution stud | 8 AWG | 810TP (#10 / M5) |
| PDM15_BPOS | MEGA 100 A | distribution stud | 4 AWG | LUG-4AWG-M8 (no part number yet) |
| PDM_BPOS | MEGA 125 A | distribution stud | 2 AWG | 2516LTP (5/16 in) |
| #59 alternator | MEGA, no rating (parts list: 200 A, builder pick) | distribution stud | 2 AWG | 2516LTP |
| ISO_PWR, ISO_SW_PWR, PCS_BATT | 10 A, 5 A, 5 A | Odyssey + / stud | 16–18 AWG | not set |

The DC-DC fuse is 40 A in its row, not 60 A.

## Candidates, from the makers' pages

| Holder | Takes | Sealing | Cable studs | Temperature | Source |
|---|---|---|---|---|---|
| **Blue Sea 7720** AMI/MIDI Safety Fuse Block | MIDI/AMI 30–200 A | sealed tethered cover, IP66, ignition protected (ISO 8846, SAE J1171) | M8 × 1.25 (5/16 in ring), 120 in-lb; fuse on M5 screws, 27 in-lb | not published | `www.bluesea.com__AMI___MIDI_Safety_Fuse_Block.md` |
| **Blue Sea 7721** AMG Safety Fuse Block (MEGA/AMG) | MEGA/AMG 100–300 A | same cover, IP66, ignition protected | M8 × 1.25, 120 in-lb | not published | `www.bluesea.com__AMG_Safety_Fuse_Block.md`; the 30–200 A and 100–300 A ranges are from the article `…The_Safety_Fuse_Blocks_[AMI_MIDI_and_MEGA_AMG].md` |
| Blue Sea 5191 MRBF Terminal Fuse Block + MRBF fuse (60 A = 5178) | MRBF 30–300 A | the fuse is IP66, ignition protected, SAE J1171; the block has an insulating cap, not a sealed cover | the block mounts on a **3/8 in terminal stud**; fuse stud M8, 5/16 in ring, 75 in-lb | not published | `…MRBF_Terminal_Fuse_Block_-_30_to_300A.md`, `…MRBF_Terminal_Fuse_-_60A.md` |
| Littelfuse MEGA-SN 880014 | MEGA up to 500 A | IP66/IP69K, ignition protected (ISO 8846, SAE J1171) | M8 | **−50 to 125 °C** | `www.littelfuse.com__mega-sn-datasheet.md`, `…880014175.md` |
| Littelfuse 1-way Sealed MIDI Holder 48V | Littelfuse MIDI 70 V SF36 ISO fuses | IP67 | **M6** | not in snapshot | `www.littelfuse.com__1-way-sealed-midi-holder-48v.md` |
| Eaton MRBF single holder kit | MRBF up to 300 A | red insulating cover, ignition protected (SAE J1171); no IP rating in the vendor text | M8 stainless | not stated | `ceautoelectricsupply.com__eaton-mrbf-single-fuse-holder-kit.md` |

The MRBF fuse interrupts 10,000 A at 14 V DC (`…MRBF_Terminal_Fuse_-_60A.md`). The same Blue Sea page says: "do not mount the fuse directly to the battery terminal". It goes on the 5191 or 2151 block.

## MRBF on the post versus MIDI for the 60 A amplifier fuse

An MRBF on the post saves joints only when the battery has a 3/8 in stud to carry the 5191 block. The YellowTop listed for the tray (Optima D34/78) has **dual SAE/GM terminals**, not a stud (`batterysales.com__d34-78-8014-045-optima.md`). The block would need a stud-type post terminal, and that adds back the joint the MRBF saves.

The 5191 also closes with an insulating cap, not a sealed cover. So for "element proof", the 7720's gasketed IP66 cover is the better pick at the YellowTop. Mount it hard beside the post on the shortest sheathed stub.

Revisit this only if the tray's battery has a 3/8 in stud.

## Pick: one family, Blue Sea Safety Fuse Blocks

The 7720 (MIDI) and 7721 (MEGA) share the same sealed tethered cover, IP66 rating, ignition protection, and M8 cable studs:

| Fuse | Holder | Fuse part (existing parts rows, standard MIDI/MEGA) | Cable end on the holder |
|---|---|---|---|
| #32 MIDI 60 A, YellowTop | 7720 | MIDI 60 A: no part number in the parts list (Blue Sea's 60 A MIDI is 5253, per bluesea.com search result, not snapshotted) | 4 AWG × 5/16 in lug (LUG-4AWG-M8) |
| DCDC_IN MIDI 40 A | 7720 | 0498040.M | 8 AWG × 5/16 in lug: **no part number in the catalog**; the 810TP (#10) no longer fits, because the cable lands on the M8 stud, not the M5 fuse screw |
| #52 MIDI 40 A | 7720 | 0498040.M | same as DCDC_IN |
| PDM15_BPOS MEGA 100 A | 7721 | MEGA-100A (no real part number yet) | LUG-4AWG-M8 |
| PDM_BPOS MEGA 125 A | 7721 | 0298125.ZXEH | 2516LTP |
| #59 MEGA (200 A candidate) | 7721 | 0298200.ZXEH | 2516LTP |

Each holder's input needs a short jumper from the Blue Sea 2019 distribution stud (3/8 in: 238LTP at the stud, 2516LTP at the holder). That is the stud-to-holder link the registry does not carry yet.

## Still open

- **Temperature rating.** Blue Sea publishes no operating temperature for the 7720/7721. If a written rating is required near the exhaust, the Littelfuse MEGA-SN (880014, −50 to 125 °C, IP66/IP69K, M8) is the documented alternative for the three MEGA positions. Its sealed MIDI sibling uses M6 studs and Littelfuse SF36 fuses, so it would split the family.
- **The 10 A, 5 A and 5 A taps.** MIDI starts at 30 A, so these need a sealed small-fuse holder. Not researched here.
- **Catalog changes owed** (for the registry lane, not made here):
  - An 8 AWG × 5/16 in lug.
  - LUG-4AWG-M8 and MEGA-100A/MIDI-60A need real part numbers.
  - Holder rows for 7720 and 7721 replacing 02980900TXN and 0498900.TXN.
  - Jumper rows from the stud to each holder.
