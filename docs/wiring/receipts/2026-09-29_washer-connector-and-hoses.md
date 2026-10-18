# Receipt: the washer end gets its connector and soft tube (ends map and part media)

- date: 2026-09-29
- change_type: substrate_correction
- scope: `ends:` WASHER-PUMP in docs/wiring/calc-data/catalog/mounts.yaml; WASHER-PUMP in catalog/part_media.yaml.
  The registry is not edited.
- follows: 2026-09-29_substrate-correction-factory-washer-pump.md (options-rd, PR #416), which corrected the catalog text
  and left the ends map to the pieces lane.

## What changed
- The WASHER-PUMP end now names its plug and hoses, and its "not recorded yet" open item is closed:
  - the washer solenoid's 2-way 12004622, on circuits 94 and 93B (the wiper motor's own 3-way is 8917544);
  - soft tube LMC 36-4070 (jar to pump, 9 ft) and 36-4071 (pump to nozzle, 12 ft), or the Classic Parts 67-865 kit;
  - LMC 36-4078 as the 1973-77 replacement pump.
- part_media WASHER-PUMP now describes the factory pump, not the Hella pump and tank.

## Evidence (each re-read by the pieces lane, not copied from the earlier receipt)
- 1978 C/K wiring booklet ST-352-78, fold-out A-1: the WASH SOL callout reads 12004622 with 18 DK BLU-94 and
  18 YEL/BLK-93B; the WIPER MOTOR callout reads 8917544. It's the closest year on file to the 1977.
- lmctruck.com "1973-84 Windshield Wiper and Washer" (snapshot fetched 2026-09-29): 36-4078 Washer Pump, Chevy GMC 73-77,
  $109.95; 36-4070 Hose-Jar To Pump-9 ft, $4.95; 36-4071 Hose-Pump To Nozzle-12 ft, $4.95.
- classicparts.com 67-865 (snapshot fetched 2026-09-29): "(1973-84) Windshield Washer Hose Kit", $11.95.
- 1977 Light Truck Service Manual p.803, Fig. 8-16: the pump mounts on the wiper motor.

## Still open
- No GM hose number was found; the hose numbers are reproduction parts.
- Whether the pump on the truck's own motor still works: bench-test it before buying 36-4078.
- The registry still names the Hella 8TW 004 223-031 (reconcile_v5.py: wire 50's terminal and the PDM30 OUT26 current
  note). That belongs to the registry owner.
- If the dash switch grounds the solenoid the factory way, PDM30 OUT26 and DIG9 come free (options-rd). That's the owner's call.
