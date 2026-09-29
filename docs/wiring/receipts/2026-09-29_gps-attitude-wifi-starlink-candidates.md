# Receipt: GPS, attitude, Wi-Fi and Starlink as candidate options

- **Date:** 2026-09-29
- **Change type:**
  - research (`research/2026-09-30_gps-attitude-starlink.md`; that filename is the lead's)
  - catalog (`calc-data/catalog/options.yaml`: 10 candidates appended). No registry, script, map-row or manual change.
- **Follows:** `receipts/2026-09-28_options-capacity-readiness.md` (the options mechanism)
- **Ask (owner, 2026-09-29, verbatim, voice-typed):** "what about GPS topology and topology I like knowing that angle position
  on the vehicle and the other important features like that communication Wi-Fi connection small starling connector
  Starlink"
- **Pre-flight:**
  - read state §1–4. Nothing here reopens a locked row: the speed source (row 0v), the one-61-pin rule (row 0ah), the DISP
    choice (owner's) and the batteries (row 57) are all left as they stand.
  - read canon ch.16 (§1.5 spec by gauge, §1.8 resistances and weights, §2.3 charts, §2.4 3 % drop, §7), ch.17 (§17.1
    1.25 × load and 0.85 × wire, §17.2 fuse within 7 in, §17.8 PDM channels and the direct-wired partition) and ch.18
  - `scripts/library_search.py` for GPS, accelerometer, inclinometer, Starlink, antenna, RS232, compass, removable top,
    steel cab and roof panel. The library holds the M130 datasheet, the M1 hardware tech spec, the C125 and PDM manuals,
    the 1977 LTSM and the VHX manual; nothing on Starlink or routers.
  - web pages were fetched on 2026-09-29 through the repo's Firecrawl path, one request per host every 10 s or more, and
    saved to `reference_documents/web_snapshots/` (gitignored). The research file lists each one (W1–W31). Firecrawl's
    shared 30-a-minute limit returned 429 twice; the fetcher backed off and retried. No account, no login, nothing bought.
    The WebSearch budget for the session was already spent, so every page was reached by its maker's own links.
  - "would Dave shred this?": crimped splices, Tefzel by the locked gauge map, loads on PDM outputs by switch position,
    nothing new through the firewall, the experiential layer (routes, lengths, lever arms, mounts) left to the mock-up

## What was built

**`catalog/options.yaml`: 10 candidates, none decided.**

| Code | What | Alternative to | PDM30 outputs | Top cavities |
|---|---|---|---|---|
| NAV | CSS CANmod.gps on the M1 CAN trunk: GPS + roll/pitch/heading | — | 0 (taps OUT29) | 0 |
| NAV-L10 | MoTeC GPS-L10 on M130 B11 (UDIG6), logged by the ECU; no attitude | NAV | 0 (1 M130 pin) | — |
| NAV-DAK | Dakota Digital GPS-50-2 on the VHX (speed, heading, altitude); no attitude | NAV | 0 | — |
| ATT-CLINO | Rugged Ridge 13309.01 stick-on clinometer, no wiring | — | 0 | — |
| COM | Starlink Mini on the steel half-cab roof; Starlink's Mini Car Adapter in its own socket on a COMMS output | — | 1 | 0 |
| COM-DASH | the Car Adapter in the existing dash outlet (OUT8), key-on only | COM | 0 | — |
| COM-ACC | camp power from the YellowTop, fused at the battery, own switch, no PDM | COM | 0 | — |
| COM-TOP | the dish on the removable top, from a socket inside the top | COM | 1 | 4 |
| RTR | Peplink MAX BR1 Pro 5G on the COMMS output; Starlink in by Ethernet; Mobility 42G | — | 0 (taps COM's) | 0 |
| RTR-T | Teltonika RUTX50 | RTR | 0 (taps COM's) | 0 |

- Keys follow the sibling lanes' extension: `product`, `taps`, `limits`, `adds`, `alternative_to`, `requires`
  (options-rd, #416; documented in the file header) and `top_cavities` (top-design, #420). `m130_pins` is
  informational. The block's header says so.
- `wire_patterns` (`^NAV_`, `^GPSL10_`, `^DAKGPS_`, `^COMMS_`, `^SL_`, `^SLT_`, `^RTR_`) match no registry wire today
  (checked against wires, implied and candidates), so they only take effect once the lead designs these into the registry.
- **Recommended set: NAV + COM + RTR**, with COM-DASH as the interim until a COMMS output exists. Why: research §4.

## Findings

- **The M130 can take GPS two ways.**
  - On CAN bus 1: its only bus (M130 datasheet p.2; no RS232 or LIN, M1 tech spec p.6).
  - As RS232 on UDIG6 or UDIG7 from a MoTeC GPS-L10, but only on rev Q or later, with Logging Level 2 (MoTeC GPS-L10 user
    manual). B11 is free; B14 is the isolator shutdown input.
  - Whether M1 GPR decodes a third-party CAN GPS/IMU is unknown. The M1 tech spec p.15 puts CAN receive in the package's
    scripts.
- **The roof over the front seats is steel.** The fiberglass top covers the rear only (1977 LTSM PDF p.155, p.157
  Fig. 2D-78). The dish and antennas go on the steel roof, so the recommended set puts nothing through TOP-DISC.
- **The IMU's reference point is the rear-axle centre, not the centre of gravity.** CANmod.gps sensor fusion needs the
  mount alignment and the lever arms from that point (CSS dyn_model and imu_mount_alignment pages). The 500 mm CAN stub
  rule (PDM manual printed p.49) puts the module under the dash near the trunk, on its own rigid bracket.
- **No PDM30 output is free for COMMS.** PW takes OUT3/OUT4; PL and top-design's TOP-LIGHT both name OUT21; options-rd shares
  OUT23/25/27/28/15/11/13.
  - COMMS takes OUT3 if PW is not fitted. Otherwise it waits for the cab-PDM decision (PDM15 to the cab, or a second body
    PDM).
  - The COMMS limit is 9 A with the router (1.25 × 6.6 A), 7 A for Starlink alone. The lead is 18 AWG (0.85 × 11 A =
    9.35 A, PDM manual printed p.48).
- **Starlink power.** Input 12–48 V, 60 W; average 25–40 W (spec sheet) or 20–40 W with a 15 W idle (help article). Starlink
  guarantees only its own supply and cable, so the pick is its own Mini Car Adapter (12–24 V outlet in, USB-C out) rather
  than a hard-wired barrel.

## Measured

`options_v5.py` was run on scratch copies of `calc-data/` (main at b6d1d397d, with options-rd #416 and top-design #420, and
this branch rebased on it), not in the repo. The registry is not edited on this branch; `OPTIONS.md` and the registry's
`options` / `capacity` keys regenerate when the lead runs the toolchain. Main's `options_v5.py` leaves alternates out of the
totals (options-rd, #416).

| verdict | main (b6d1d397d) | this branch |
|---|---|---|
| PDM30 outputs | candidates would take 7; 3 spare | 8; 3 spare (COM's COMMS output) |
| PDM30 inputs | 3; 2 spare | 3; 2 spare |
| body crossings | 2 | 2 |
| alternates listed, not summed | MCAM-BIL, BSM-SD2, MTS-SOG, PUD-MIR, MIRD-FV, MIRD-360 | + NAV-L10, NAV-DAK, COM-DASH, COM-ACC, COM-TOP, RTR-T |

- Options: 49 (45 candidate, 3 decided, 1 base). Buildable and composite wire counts are unchanged, because the candidates
  are undesigned and live in `adds`.
- Planned wires: NAV 5, NAV-L10 3, COM 4, COM-ACC 2, COM-TOP 12, RTR 4.
- Drops (canon ch.16 §1.8 resistances; lengths are estimates):
  - COMMS: 0.33 V (2.4 %) at 6.6 A over 8 ft of 18 AWG
  - COM-TOP: 0.39 V (2.8 %) at 5.0 A (12 AWG body, 2 × #20 per pole, 16 AWG top side, 14 AWG return)
  - NAV: 0.003 V

## Coordination
- **top-design** (two messages, 2026-09-29; their TOP-DISC entry, merged in #420, records the steel half-cab roof and
  reserves the 4 cavities; no reply received before this receipt):
  - Nothing of this lane crosses TOP-DISC in the recommended set.
  - COM-TOP would use the 4 spares top-design reserved ("4 of the spares for a top-mounted Starlink DC pair") as 2 × #20
    per pole.
  - NAV taps OUT29 beside top-design's CANKEY keypad. COM uses a CANKEY button for its camp latch if CANKEY is built.
- **options-rd:** no output claimed that options-rd uses (OUT23/25/27/28/15/11/13).
- **The lead's "check before you claim":** OUT21 is left to PL / TOP-LIGHT; OUT3 is named for COMMS only if PW is not fitted.

## Substrate inconsistencies (flagged, not fixed)
- **April candidate row `dash-cabin-W090`** ("GPS_Antenna → COAX M130_GPS_IN", SMA RG174). The M130 has no antenna or GPS pin
  (M130 datasheet pp.4–5); the lead should retire or rewrite it.
- **CAN shielding.** Canon ch.16 §7.1 lists CAN as shielded. The CAN-BUS endpoint and registry run it twisted 22 AWG
  M22759/16, per the PDM manual printed p.49. The NAV stub follows the trunk.
- **CANmod.gps supply range.** The connector page says 5–24 V on pin 9; the spec page says 5.0–26 V. A 12 V system is inside
  both.
- **CANmod.gps size.** The shop page gives 65 × 48 × 24 mm and 70 g; the docs give 48 × 70 × 24 mm and 75 g.
- **Starlink Mini average power.** The spec sheet says 25–40 W; the help article says 20–40 W with a 15 W idle.

## Open (named close paths)
- **Skylar only:**
  - camp use and which battery
  - Roam plan (in-motion) and a cellular plan
  - drilling the steel roof (43 mm antenna hole, dish mount, cable gland) or the dish on the top
  - the DISP choice, or the stick-on clinometer
- **Dave / MoTeC:**
  - M1 GPR receive of third-party CAN frames
  - M130 revision (Q or later)
  - GPS-L10 0 V and 5 V landing
  - the trunk bit rate and ID map
  - which of the PDM's four stay-alive outputs are taken
- **Not published or not fetched:**
  - Car Adapter minimum input and loss
  - Dakota GPS-50-2 power (its manual answered HTTP 500)
  - RUTX50 input range
  - Peplink Micro-Fit pin order
  - Mobility 42G mass
  - prices for the Mini kit, its accessories, both routers and the GPS-L10
- **Mock-up:**
  - roof size (T-15)
  - pillar route and every length
  - rear-axle lever arms
  - COMMS draw at the socket
  - Mini Wi-Fi inside the cab
  - summer cab temperature under the dash (the CANmod.gps is rated to 70 °C, the Starlink Mini to 50 °C)
