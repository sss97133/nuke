---
id: 2026-10-15_pdm-channel-settings-fold
change_type: data_model
scope: pdm_channels setting columns; load_pdm_settings(); fold_harness_net_protection carries limits and loads to nets; four scoreboard measures; load_map_rows.py passes the registry's pdm_settings after every run
case: docs/ledger/theory/data-machine-cases.md 13.12.3
migration: supabase/migrations/20261015043000_pdm_channel_settings_fold.sql
contract: supabase/sql/test_k5_pdm_channel_settings_fold.sql (db-contracts)
---

# RSI pass 15: each PDM output's limit and load land in the model

**Gap.** A PDM output's programmed limit is its fuse. The registry computes one per output in
`reconcile_v5.py pdm_settings`:
- at least 1.25 x the cited running current;
- at most 0.85 x the ampacity of the thinnest conductor it feeds;
- whole amps, with 8 A outputs capped at 10 A and 20 A outputs at 25 A (MoTeC PDM manual pp.24, 36, 48).

`k5_registry.json` holds 39 outputs: 20 set, 18 open (each naming the current it still needs) and 1 conflict
(PDM30 OUT21 needs 12 A; an 8 A output caps at 10 A). None of it reached the model:
- `pdm_channels.fuse_rating_amps` holds the pins' hardware class.
- `harness_nets.protection_setting_a` was empty on all 338 nets.
- The 12 net loads were all DC-primary cables.

**Change:**
- `pdm_channels` gains `max_current_setting_a`, `load_a`, `setting_status` (set | open | conflict), `setting_basis`
  (the registry's source and verdict, verbatim), `setting_loads` (the wires fed), `setting_source` and
  `setting_observed_at`.
- `load_pdm_settings(vehicle, rows, source)` writes them from the registry's rows, clears channels the rows stop
  naming, and re-folds protection. It is idempotent and runs as service role only. The loader passes
  `reg["pdm_settings"]` after every run, and the first load follows the deploy by that same call.
- `fold_harness_net_protection` carries the limit to every net its channel protects. It carries the load only when every
  wire the output feeds sits in that net; pass 14 made each multi-load output one net. A load split over several nets
  is not divided.
- New scoreboard measures:
  - PDM-fed nets with a programmed limit;
  - PDM-fed nets with a load;
  - PDM outputs still waiting on a cited load current (the evidence backlog);
  - PDM outputs whose load needs more than the output or its wire allows (must be 0).

**Expected after the first load:** 40 channels written (39 rows, one a pair), 18 open, 1 conflict (PDM30 OUT21).

**Unknowns:** none for this change. The 18 open currents are named in `setting_basis`: the horn, the blower on each
speed, the E-Stopp, the RVS camera and mirror, the RetroSound, the M130 supply, the Hella washer pump, the Dakota VHX
and GSS-3000, the Blue Sea 1045, the coil packs, the starter solenoid, the A/C clutch, the PCS ignition and the
iBooster wake.
