# Chapter 1: The Workshop Model

## The Three Elements

A workshop that builds wiring harnesses needs three things:

**The Vehicle** — the ask. A client brings a 1977 K5 Blazer and says "I want a Motec-based wiring harness." That's the starting point. The vehicle defines what's possible (squarebody chassis, LS3 engine, specific mounting locations) and what's needed (every electrical device the truck will have).

**The Workspace and Supplies** — the supply chain. ProWire USA has 9,649 parts indexed. Desert Performance has Motec dealer access. Davis Off Road machines step brackets in his garage. Aeromotive ships fuel pumps. The workspace is the catalogs, the tools, the wire spools, the connector kits, the crimp tools. Without the workspace, you can't build.

**The Intelligence** — what needs to be done. When a Motec dealer hears "I want Motec," half the job is already defined in their head. Pin A1 is Injector 1. The crank sensor needs shielded wire. The PDM30 replaces the fuse block. Star grounding is mandatory. CAN bus needs 120-ohm termination at each end. This knowledge is implicit at a professional shop. Our system makes it explicit.

## The Implicit Half

The difference between a JEGS harness kit and a Motec installation:

A JEGS kit comes with a bag of labeled wires and a fold-out pamphlet. The customer does all the thinking. Which wire goes where? What gauge? What color means what? The intelligence is in the pamphlet and the customer's head.

A Motec dealer's installation is the opposite. The customer says what they want. The dealer knows everything else. The M150 ECU has 120 pins, each with a defined function. The PDM30 has 30 programmable channels. The sensor suite has specific part numbers, connector types, wire gauge requirements, and shielding specifications. The dealer doesn't need to look any of this up — it's in their head from doing dozens of builds.

Our system encodes the dealer's head into a database. Every device is a digital twin with documented endpoints. When you place an M150 and an LS3 sensor suite on a vehicle, the system KNOWS every wire that connects them — because the M150's pin map says A1 is Injector 1 Low Side, and the LS3's injector spec says it's a 2-pin EV6/USCAR connector drawing 4A through 18AWG wire.

## The Harness Is Derived, Not Designed

You don't design a harness. You:

1. **Select devices** — LS3 engine, Motec M150, PDM30, Denso D510 coils, Aeromotive fuel pump, Dakota Digital gauges, LED headlights, etc.
2. **Place them on the vehicle** — engine bay, firewall, dash, doors, rear, underbody
3. **The system computes everything else** — wire gauge from amperage + length, wire color from function group, fuse rating from load, PDM channel from current draw, ECU model from I/O count, alternator size from total current

This is the same principle as how wire gauge works. You don't pick 18AWG because it seems right. The system calculates: this circuit draws 4A over 3.5 feet at 12V with a 3% max voltage drop → 18AWG is the smallest gauge that meets all constraints. The gauge is DERIVED from the requirements.

The entire harness works the same way. Every wire, every connector, every fuse, every channel assignment — derived from the device endpoints and the laws of physics.

## What Changes When You Add One Device

Add AMP Research power steps to the build:
- +10 wires (power, ground, 4 motor wires, 2 door triggers, 2 courtesy lights)
- +3 PDM channels (or 1 if controller handles distribution)
- +8A peak draw per step during deploy
- Alternator requirement recalculates
- PDM channel count goes from 27/30 to 30/30
- System warns: "PDM HEADROOM: 0 channels remaining"
- BOM adds: Far From Stock P300 kit $2,264 or Engineered Vintage mount kit $848

One device. The entire harness specification updates. That's the system.
