---
id: 2026-09-29_owner-calls-one-61pin-at-fusebox-hole
change_type: owner_decision_record
scope: docs/wiring/calc-data/catalog/mounts.yaml (map panel WHERE EACH BOX GOES), state row 0ah
source: owner, 2026-09-29 morning, in the pieces lane's window. Relayed to the lead verbatim; not yet repeated in the lead's own chat (confirm)
---

# Owner calls: one 61-pin at the fuse-box hole; nothing else through the firewall

## The calls (verbatim as relayed)
1. "the 61 pin connector should be placed at the original fuse box hole with a cnc'd adapater plate"
2. Dave via the owner: "the only reason to run a 61 pin is so you dont have any other wires going through the firewall. putting a bulkhead next to it is a problem."
3. Other bulkheads: only "the sick ones that are round"; a small one "in the back for fuel and tail lights and rear stuff" is fine if it proves best.
4. ECU and PDMs: "somewhere awesome and safe".

## What changed on the surface
- FIREWALL-61 → decided: driver side, original fuse-box punch-out (objectTraits FB, 4 in), CNC'd adapter plate.
- BODY-PASS (Deutsch A/B/C/P) → dropped (flag). Its 30 wires are mostly front-end loads; the candidate is a sealed bay PDM
  driven from the cab switches over CAN (MoTeC PDM manual p.19). That needs about 22–27 outputs, which is a PDM32
  (pp.35–36). Not decided until Dave answers.
- M130 and PDM30 → open: they follow the 61-pin to the driver side; the spot waits on Dave.
- REAR-CONN → new, open: a round rear connector for fuel, tail and rear lamps, the speed sender and the camera.

## Not changed (needs Dave, then a registry pass)
The registry (endpoints, crossings, the 61-pin cavity map, PDM assignments) still describes the old crossing plan.
Questions for Dave (owner sends): the battery feed and ground returns, engine-side sensor splices (16 → 4 wires),
the isolator's 4 switch wires, the rear connector, and where the M130 and the cab PDM go.
