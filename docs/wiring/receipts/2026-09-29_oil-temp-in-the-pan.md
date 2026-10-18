# Receipt: the oil temperature end is GM's sensor in the oil pan (from the engine photos)

- date: 2026-09-29
- change_type: substrate_correction
- scope: `ends:` in docs/wiring/calc-data/catalog/mounts.yaml, entry OILT (position only; the registry is not edited)
- amends: 2026-09-29_where-each-end-is.md (OILT was "open: a port on the oil cooler adapter")

## What changed
OILT moves from `open` to `fixed_by_engine`: GM's oil level and temperature sensor already sits in the LS3's oil pan,
passenger side, on a boss just behind and below the right knock sensor.

## Evidence
1. The owner's photo of the long-block over the frame, 2024-08-24 (vehicle_images 9365b1d0), zoomed on the passenger
   side: a tan hex-bodied sensor with a two-cavity plug face and a sealing washer, threaded into a boss on the oil pan
   below the pan rail; the right knock sensor sits just above and ahead of it.
2. The owner's photo of the engine top from behind, 2024-08-25 (vehicle_images 8e79c104): the only sensor on top is the
   oil pressure sensor at the rear of the valley cover. The owner remembered the oil temperature sensor "on top of the
   engine"; the photos place it on the pan.
3. Gen IV LS3 oil pans carry a 3-wire oil level and temperature sensor in an M20-1.5 port: ebay.com/itm/153376028423
   (pigtail listing) and nzefi.com "GM Gen IV LS2/LS3 Oil Level & Temp Sensor Connector" (fetched 2026-09-29); the
   ICT Billet 551413 plug for that port is listed as M20-1.5.
4. Against: a Camaro5 forum thread (camaro5.com/forums/showthread.php?t=333771, search snippet 2026-09-29) says the
   pan sensor reads level only and the car models oil temperature.

## Unknowns (they keep the M130 wiring open, not the position)
- The sensor's part number: read it off the body. It decides whether there is a temperature element for the M130.
- The registry's OILT plug is a GT150 2-way; the factory sensor is 3-wire. For the registry owner to decide.
- If the sensor reads level only, a separate oil temperature sensor goes in a tee at the top-rear oil pressure port,
  beside the M130's pressure sensor and the Dakota sender.

## Also found (no change here)
The 2023-11-13 photo captioned by the vision pass as an "oil-cooler/filter-relocation kit" shows an ICT Billet 551628
SBC-to-LS engine swap bracket set (the number is engraved on the plate; summitracing.com/parts/icb-551628). The oil
cooler in the build log is still unidentified.
