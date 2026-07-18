# Receipt — Wiring Canon External Ingestion (chapters 16-18)

**Date:** 2026-06-19 · **Change type:** substrate_correction + research-ingest (canon UNKNOWNs closed with external citations) · **Status:** executed · **Workflow:** `wf_84ec1381-f5b` (6 reachable targets, 47 sourced findings, 26 chapter edits)

## Why
The 2026-06-18 canon (chapters 16-18) marked ~23 facts `UNKNOWN — pending ingestion` rather than fabricate them. This pass ingested the **publicly-reachable** authoritative sources (HP Academy excluded — needs BYOK) to close them. It did more than fill gaps — it **reversed 7 wrong claims** in our own canon/substrate, each now sourced. The discipline catching our own confident-wrong facts is the point.

## Reversals / corrections (external source contradicts prior canon)
1. **"0 AWG M22759/16 does not exist / /16 maxes at 2-4 AWG" — FALSE.** M22759/16 is manufactured **24 AWG → 2/0** (incl. 0 AWG = /16-01). Three independent sources: ProWire/Thermax datasheet, Jaycor, **NASA NEPP/NPSL**. The cut-list 0 AWG /16 (#6/#59/#63) is BUILDABLE; "4-10 AWG = /16" is this build's MAPPING CHOICE, not a spec ceiling. Fixed in ch16 §1.4/§4, ch17 §17.5.1/§17.5.6, and **K5_WIRING_STATE.md §1** (which had the wrong "impossible" lock — propagated by the agent to Skylar verbally too).
2. **"135 A @ 4 AWG free-air" FAILS verification** — ProWire's own chart shows 72 A (35°C rise) / 40 A (10°C rise). The power-spine study's figure was unsupported. ch16 §2.3 / ch17 §17.5.
3. **ABYC DC bundle derate = flat 0.7 (−30%) once bundled >24 in / 610 mm**, regardless of count. The 30/40/50/60% cascade is **AC-only**. ch16 §2.2 / ch17 §17.5.4. (ABYC E-11 Table VI + §11.14.3.7.1.)
4. **"16 AWG = 50 lbf" pull-force is a one-gauge MISLABEL** — 50 lbf = 14 AWG; 16 AWG = 30 lbf (UL486/A-620 lineage). ch16 §8.3, flows to ch18 §7.
5. **SCL = AMS-DTL-23053/4 CLASS 1, −55/+110°C** (not Class 2, not the DR-25 −75/+150 envelope). ch16 §6.
6. **S03 SolderSleeve = SAE-AS83519**, not M23053/18 (PVDF material was right). ch16 §6/§7.3.
7. **Aeromotive A1000 fuel pump draws ~12 A @ 45 psi, not 35 A** — the 35 A is the 16301 wiring-KIT/breaker rating. ch17 §17.5/§17.8 (the 8 AWG feed is heavily over-spec'd).

## Clean closes (UNKNOWN → sourced)
- ch16 §1: M22759/16 per-AWG strand / OD / DC-resistance / weight tables (ProWire/Thermax); /16-extruded-vs-/32-cross-linked externally confirmed (SAE AS22759/16A title + TE).
- ch16 §2.5: "core runs hottest" → NASA NESC-RP-17-01264 + AS50881 primary source.
- ch16 §6: DR-25 / SCL / ATUM per-size tables + selection rule + AMS-DTL-23053 slash-sheet material map (TE/Raychem datasheets).
- ch16 §8.2/§8.4: IPC Class 1/2/3 definitions + full 30-10 AWG crimp pull-force table.
- ch17 §17.2.1: verbatim ABYC E-11 §11.10.1.1.1 (7"/40"/72", with 40-vs-72 disambiguated: 72"=Exc.2 battery-terminal, 40"=Exc.3 non-battery); §17.2.5 verbatim cranking exemption (Exception 1); §17.1.3 ABYC coordination rule.
- ch17 §17.5 fan branch: SPAL 16" puller **measured 19.6-21.3 A each** (dual ≈ 39-43 A); iBooster 40 A = OEM supply-fuse rating + 5 A ignition.
- ch17 §17.9.5 / ch18 §3.2/§3.3: **D38999 25-61 = 61×#20 is the MAX-cavity shell-25 arrangement; mixed #16+#20 inserts have FEWER cavities → a mixed insert is NOT a cavity-count fix for the 8-wire overflow.** Resolve by engine-only segmentation / 2nd crossing (the engine-only direction Dave pushed). #20=7.5A/20-24AWG, #16=13A/16-20AWG.

## Still UNKNOWN (honest — not closed)
- **Concentric-twist DESIGN** (same-direction/same-pitch replacement rule, layer counts, lay length) — EXCLUDED, needs **HP Academy (BYOK)** or a MIL/SAE lay-up standard. The "alternating-direction" supersession at `03-tier-system.md:46` stands; the positive replacement stays UNKNOWN.
- True **150°C-absolute free-air ampacity** base table (no manufacturer publishes /16 on that basis; ProWire is rise-basis, Pegasus is 150°C-bundled).
- Single-conductor ampacity for **0 AWG / 2-0 /16**; verbatim wall-mils + paywalled cells (/5,/15,/18 dims, A-620 19-12/19-13 exact cells, revision pinning).
- **LS3 starter PN + cranking current** and **CVF alternator PN + output** — owner/build facts, unreachable from datasheets (measure off the installed units).
- **E-Stopp ESK001 install sheet** + **AS81765/1 Y-boot PNs** — not in this ingest batch.
- Per-wire DR-25/SCL final size — HANDS deferral (verified bundle ODs off the formboard, Dave step ③).

## Sources
Per-update source URLs are cited inline in the chapters. Headliners: ProWire/Thermax M22759/16 datasheet, NASA NEPP/NPSL, Jaycor, ABYC E-11 (Paneltronics excerpts), TE/Raychem DR-25 + SCL datasheets, Milnec MIL-DTL-38999 insert tables, SPAL datasheet, Aeromotive A1000 spec, UL486/Checkline pull-force.
