# K5 Endpoint Load & Termination Schedule (grounded)

**Date:** 2026-07-12 · 1977 K5 Blazer · LS3 · M130 + PDM30
**Method:** 6 device buckets sourced from datasheets + adversarially current-verified (workflow wf_6a2e6198). Every cell carries a provenance tag. This is the schedule the wire gauges *derive from* — replacing the cut list's "Est. Amps."

**Provenance of 38 power endpoints:** DATASHEET_GROUNDED 11 · PDM_CHANNEL_BOUNDED 13 · DEVICE_UNKNOWN 12 · LENGTH_NEEDS_TRUCK 2
→ **24 of 38 are defensible now** (grounded or channel-bounded). 12 need a device ID, 2 need the truck.

---

## The one thing that matters for the gauge: PDM protects the wire

A wire on a PDM output is sized to the **channel trip point** (8A or 20A), not the device. So every PDM-fed motor/light gauge holds **regardless** of which fan or motor is actually installed — the device identity only sets the PDM software current-limit and decides *channel fit*. The gauges that ride on real device current are the **direct-wired loads + the DC primary** — and those are exactly where grounding moved things.

---

## Load schedule (grouped)

### Cooling / HVAC — all DEVICE_UNKNOWN, but gauges hold (20A channels)
| Wire | Device | Grounded draw | Gauge | Provenance | Flag |
|---|---|---|---|---|---|
| #21 | Radiator Fan 1 | 8.5–28.5A (SPAL-class; hi-perf 17–28A) | 12 AWG (OUT1 20A) | DEVICE_UNKNOWN | **hi-perf fan >20A breaks the channel** |
| #22 | Radiator Fan 2 | 8.5–28.5A | 12 AWG (OUT2 20A) | DEVICE_UNKNOWN | separate channel = correct |
| #25 | Electric Water Pump | 3–12A (Meziere/Davies-Craig) | 14 AWG (OUT5 20A) | DEVICE_UNKNOWN | **may not even exist — CVF drive likely has a mechanical pump** |
| #51 | Heater Blower | 14–20A hi speed | **12 AWG** (was 10) | DEVICE_UNKNOWN | resolve 10-vs-12 AWG → 12; control path (resistor vs PWM) open |

### Body motors — gauges hold; one channel-fit problem
| #34/#35 | Power Windows L/R | 5–10A run / 10–15A stall | 12 AWG (OUT3/4 20A) | PDM-bounded | ok |
| #38/#47 | Power Locks L/R | 2–5A pulse | 18 AWG | PDM-bounded | ok |
| #49 | Wiper Motor | 2–5A run / **10–12A stall** | 18 AWG | DEVICE_UNKNOWN | **stall exceeds 8A OUT12 → nuisance-trip; move to a 20A channel or protect at 10–15A** |
| #1/#2 | AMP PowerStep L/R | 4–8A deploy (est; AMP only publishes 30/40A system fuse) | 18 AWG | est (not datasheet) | ok |
| #54 | Electric Parking Brake = **E-Stopp ESK001** | 8–10A apply | 16 AWG | DATASHEET_GROUNDED | **see substrate correction** |

### Lighting — all LED, low, gauges/channels safe
| #85/#86 | LED Headlights L/R | **1.8A low / 3.6A high** per lamp (corrected from a fabricated 1.2A) | 20AWG feed/16AWG legs | grounded | set PDM limit >3.6A, not 3A |
| groups | Park/tail, backup+cam, markers, interior | 1.3–3.5A aggregate each | 22 AWG | PDM-bounded | ok |

### Direct-wired big loads — sized to real current (the exposed ones)
| #66 | Fuel Pump — Aeromotive A1000 | **12A cont / 25–35A peak** | 8 AWG /16 | GROUNDED | check Vdrop over ~18ft |
| #52 | Brake Booster — Bosch iBooster | <10A normal / 40A peak | 8 AWG /16 | LENGTH_NEEDS_TRUCK | ok gauge |
| #32 | Audio Amplifier (Kicker) | **UNKNOWN — 1000W amp = 80–150A peak, fused 60–100A** | **8 AWG likely UNDERSIZED** | DEVICE_UNKNOWN | **confirm audio in/out of scope** |
| #INJ_PWR | Injector +12V rail (8× Deka) | 1.08A/inj, RMS <5A | 16 AWG | bounded | ok |
| #COIL_PWR | Coil +12V rail (8× D510C) | **8–12A cont at high RPM** | **14 AWG** (was 16) | bounded | **needs a 20A channel — currently unassigned (OUT?), and PDM is 30/30 full** |

### DC PRIMARY — where grounding changed the answer
| #6 | Starter (LS3) | **175–250A crank, >300A spike** | **0 AWG / 1-0 — NOT 2 AWG** | LENGTH_NEEDS_TRUCK | 2 AWG is a premature downgrade until run length measured |
| #59 | Alternator B+ | 140–250A = rated output | **PENDING alt model** | DEVICE_UNKNOWN | sets gauge + P4 fuse |
| #63 | Battery Disconnect (master kill) | 100–200A+ | pending | DEVICE_UNKNOWN | **actual device unidentified (NOT the E-Stopp)** |
| #PDM_BPOS | PDM30 feed | 100A datasheet max | 0 AWG /16 or 2×4 parallel | GROUNDED | ok |
| #ECU_PWR / GND1 / GND2 | M130 power + parallel grounds | 5–7A cont (est) / return currents | 16 AWG /32 | est | ok |

---

## SUBSTRATE CORRECTIONS surfaced (file receipts before locking)
1. **E-Stopp ESK001 is the electric PARKING/EMERGENCY BRAKE, not the battery disconnect.** State file §1 + wire #126 call it the "remote battery disconnect" — that's wrong. ESK001 (#54, OUT7) is the EPB. The actual master battery cutoff (#63) is a **separate, still-unidentified device.**
2. **Blower #51 gauge:** cut list = 10 AWG, PDM plan = 12 AWG. Resolve to **12 AWG** (20A channel).
3. **LED headlight draw** was fabricated (1.2A high); real ≈ 3.6A high per lamp. Gauge/channel unaffected; the PDM current-limit must be set >3.6A.
4. **Coil +12V rail** is on "PDM30:OUT?" — unassigned — and its 8–12A continuous wants a 20A channel that doesn't exist (30/30 used). Design resolution needed.

---

## THE PUNCH LIST — what you must confirm (ordered by order-impact)
1. **DC-primary spine — starter cable gauge + run length.** Cranking is 175–250A+; 2 AWG is marginal. Measure the battery→starter run on the truck; likely **keep 0 AWG/1-0 for the starter**, use lighter gauge only for the smaller branches. *(Blocks the spine wire + lug order.)*
2. **Alternator model** → sets #59 gauge + P4 MEGA fuse. *(Blocks spine.)*
3. **Audio: in or out?** If in, the amp feed is undersized (needs 4 AWG+); if out, delete #32 + the speaker/sub wires. *(Changes wire + possibly a fat feed.)*
4. **Radiator fans ×2** — identify make/model (draw 8.5–28.5A; hi-perf breaks the 20A channel). Gauge unaffected, but sets the PDM limit + confirms channel fit.
5. **Electric water pump** — confirm it exists (CVF drive likely runs a mechanical pump) and the model. If absent, frees OUT5 on a full PDM.
6. **Master battery disconnect** — identify the actual device (#63); it is *not* the E-Stopp.
7. **Wiper motor** — stall (10–12A) exceeds its 8A channel; identify + move channel or reprotect.
8. **Blower motor** + control path (resistor vs PWM); window/wiper motor identities for channel fit.
9. **Run lengths** (Dave's on-truck step) for every wire before final cut — especially the long fuel-pump/iBooster/rear runs.

---

## ORDER VERDICT — grounding CONFIRMED ~80% and isolated the risk
- **SAFE TO ORDER NOW (grounded or channel-bounded):** all Tefzel signal wire, all PDM-fed mid-gauge wire, junction stud + all fuses, battery, crimper, heat shrink + boots, stripper. ≈ **$3,100.** None of it moves with the device unknowns.
- **HOLD until the truck/Dave pass (1 item pushed out of "buy now"):** the **DC-primary spine wire + lugs (~$680) + alternator (~$349)** — because the starter now wants to stay fat (not 2 AWG), the alt model sets its cable, and the stud sizes need the truck. Buying the spine blind is the one place we'd waste money.

**Net: grounding didn't blow up the order — it made the immediate buy smaller and safer (~$3,100, all defensible) and pinned the ~$1,000 of fat-cable + alternator to a short punch list you close on the truck.**
