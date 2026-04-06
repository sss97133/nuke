# Wanted Documentation — Behind Paywalls or Not Yet Found

Documents the user identified on Scribd that we need to find free versions of,
plus other gaps identified during the component library build.

## 6L80/6L90 Transmission (PRIORITY — complex wiring component)

| Scribd URL | Title | What It Contains |
|-----------|-------|-----------------|
| scribd.com/document/831548250 | ~~Chevy LS3 Assembly Instructions~~ | Actually a 3D print model, not useful |
| scribd.com/document/409250617 | 6L80E | 6L80E transmission service/repair manual |
| scribd.com/document/957345186 | 6L45/6L50/6L80/6L90 | Combined transmission family manual |
| scribd.com/document/852932433 | Cuerpo de Valvulas 6L80/6L90 | Valve body diagram (Spanish) |
| scribd.com/document/462946646 | 6T70/6L80 | 6T70 vs 6L80 comparison/service doc |
| scribd.com/document/338022518 | Install 6L80 | 6L80 installation guide |
| scribd.com/document/713197355 | 6L80/6L90 KWIK Reference Guide | Quick reference for rebuild/service |

**What we need from these:**
- 6L80E external connector pinout (32-pin) — every pin, function, wire color
- Internal TCM connector pinout (if applicable to year)
- Solenoid identification and resistance values
- Speed sensor locations and connector types
- Pressure switch locations
- CAN bus communication protocol with ECU
- Fluid temperature sensor connector
- TCC (torque converter clutch) solenoid wiring
- Valve body solenoid layout diagram

## ACDelco Connector Catalog

| Scribd URL | Title | What It Contains |
|-----------|-------|-----------------|
| scribd.com/doc/228494932 | ACDelco Pigtail Catalog 2013 | All Delco pigtail connectors organized by cavity count with color photos and part numbers (GM + ACDelco) |

**What we need:** Every pigtail PN for LS3 sensors — harness-side connectors for CKP, CMP, TPS, MAP, ECT, oil pressure, knock, injectors, coils.

## Gaps From Component Library Build

| Component | What's Missing | How to Get It |
|-----------|---------------|---------------|
| Meziere WP319S | Front-face bolt pattern drawing | Contact Meziere |
| SPAL 30102052 | Mounting template with hole positions | Call SPAL 800-454-7725 |
| Dorman 746-014 | Actuator body dimensions | Call Dorman 866-933-2911 |
| Bosch iBooster Gen 2 | Complete 26-pin pinout (all pins, not just 7) | Fast and Quiet connector set has downloadable pinout |
| AMP Research P300 | Controller box dimensions | Call AMP 888-983-2204 |
| Radiator (any) | Mounting hole positions for 73-87 core support | Contact radiator manufacturer |
| GM E38/E67 ECU | Factory ECU 73+40 pin pinout (for reference, not our ECU) | GM TIS / AllData subscription |

## Brake System Engineering

| Source | Title | What It Contains |
|--------|-------|-----------------|
| scribd.com/document/585359305 | iBooster 292000P12J brochure | Bosch official product brochure — CAN protocol hints, operating modes |
| scribd.com/document/816379065 | Brake sheet solution problem 3-4 | Brake system engineering calculations — pedal ratios, MC sizing, force calcs |

**CAN HACKING PRIORITY:** Decode iBooster Gen 2 CAN protocol so Motec M130 can control it directly. Resources: irate4x4 Bible thread, EVcreate, SGH Innovations (they solved it — $350 controller replicates messages).

## Dakota Digital / GPS Speed

| Source | Title | What It Contains |
|--------|-------|-----------------|
| scribd.com/document/742596188 | GPS-50-2 | Dakota Digital GPS speed sensor/interface — USER WANTS TO BUILD OWN VERSION |

**BUILD TARGET:** Replace Dakota Digital SGI-100BT bridge + GPS-50-2 with a native CAN solution. Motec M130 already has speed data on CAN — need to either (1) get Dakota Digital to read CAN, (2) build a CAN-to-analog bridge, or (3) replace Dakota gauges with Motec C125.

## Body Panel Reference (Harness Mounting Surfaces)

| Source | Content |
|--------|---------|
| rustbuster.com/collections/1973-1987-chevy-c-k10 | Complete replacement body panels — floor pans, cab corners, rockers, fenders, firewalls, bed panels. Product photos show stamped holes, grommet locations, harness clip mounting points. These panels define where wiring physically routes and grounds. |

**Relevance to wiring:** Every harness clip mounts to stamped sheet metal. Every ground point bolts to body panels. Every wire pass-through goes through a grommet in a body panel. The panel shapes = the wiring routing surfaces.
