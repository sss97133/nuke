# Receipt: firewall allocation proposal, and the brake warning switch end

- date: 2026-09-30
- change_type: research (the allocation) + substrate addition (one end, one wire)
- scope:
  - docs/wiring/research/2026-09-30_firewall-allocation.md: new.
  - docs/wiring/calc-data/catalog/endpoints.yaml: BRAKE-WARN-SW.
  - docs/wiring/calc-data/reconcile_v5.py: implied wire BWS_SIG.
  - Regenerated: k5_registry.json, OPTIONS.md, WIRE_CHECKS.json, and the `ends:` in catalog/mounts.yaml with k5-mounts.json.
- owner direction: 2026-09-29, "prioritize which need to go in the 61 pin and then we can suggest other solutions ... this is
  up to the engineer to ruminate on"; and on the valve, "we can wire that and code that".

## What changed

1. **BRAKE-WARN-SW.**
   - The one-wire warning switch on the proportioning (combination) valve, on the front crossmember under the radiator.
   - It's read on PDM15 DIG2 (A19) through wire BWS_SIG, 20 AWG M22759/32, and sent over CAN as its own dash message.
   - The valve body is the return (1977 LTSM PDF p.406).
   - Status: proposed. Its part number and exact spot are open.
2. **The allocation proposal.** The 61-pin carries 50 engine-management wires, 2 CAN and the isolator's 3 remote-switch
   wires. The headlights, blower and wipers become cab switch inputs driving engine-bay PDM outputs over CAN. The engine-bay
   box becomes a PDM32. The registry is not rewired for this until Dave and the owner confirm.
3. **The registry rebuild** (reconcile_v5.py, then options_v5.py) also brings k5_registry.json and OPTIONS.md up to date
   with the catalog and options already merged on main. Before this pass, main's registry was behind endpoints.yaml for
   WIPER-SW, WIPER-MOTOR and WASHER-PUMP.

## Checks

- reconcile_v5.py: 179 endpoints and 247 implied wires (BWS_SIG among them).
- check_plug_ends.py --wires: the engine-run set passes every rule, and the 61-pin is at 58/61 with spares d, t, u.
  R13 fails on 11 devices, as it already did on main: the April rows against locked decisions, for the registry pass.
- options_v5.py: PDM15 inputs are 3 used, 13 spare.
- mounts_v5.py: 179 ends, lint clean.
- No order numbers, amounts or addresses were added.

## Still open (for the registry pass and Dave)

- The registry rewiring for §3 of the research file, after Dave's sign-off:
  - the wiper park logic;
  - the blower as resistor taps or PWM;
  - ISO_KILL hardwired or over CAN.
- Retiring the 11 R13 rows and the 28 endless registry wires.
- The vendor order references still in endpoints.yaml, and in the registry text copied from it (a scrap-yard order, a TCM
  order, an eBay item): replace them with database ids.
