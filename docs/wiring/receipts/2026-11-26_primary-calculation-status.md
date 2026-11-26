# Primary-cable calculation status correction

Change type: bounded source-guidance correction. The read-first `K5_WIRING_STATE.md` and September receipt still present the historical cable study as a closed physics answer, despite the limits now recorded in [CABLE_SIZING](../calc-data/CABLE_SIZING.md) and the [retained thermal-source review](../research/2026-11-26_thermal-source-custody.md). Correct those entry points so they preserve the authored plan without promoting it to current installation or order approval.

The retained MoTeC table is indicative and specifies single wire in free air, with separate ambient columns and a maximum permitted wire temperature. It does not establish a sleeved truck installation, operating load or missing route length. A recommended amplifier fuse does not establish its operating current. The cited ABYC document is a historical marine reference, and its cranking exemption does not by itself establish a governing motor-vehicle requirement. The underlying manufacturer and ABYC source identities and reviewed pages are in the linked research record and chapter17.

The existing retained wire-resistance source distinguishes ordinary 1 AWG, 1/0 (source size01) and 2/0 (source size02). Correct the state page's mistaken size01-to-2/0 assertion; availability of a material class alone does not establish buildability. Existing exact catalog-key handling belongs to `key_harness_segments` and `harness_schematic_model` (migration20261126195800), not a new sizing choice.

No source input, historical calculation result, selected wire, physical route, battery location, harness piece, stock quantity, cart or production row is rewritten. The missing physical parallel-conductor accounting is separately reported as canonical observation `29625c5e-bdd2-407b-94ea-4dd815a3dcae`; that report is an attributed review finding rather than proof of installed missing wire or a repair. Overall builder/order acceptance remains open.

Validation is exact prose diff review, local relative-link checking and the repository gate, followed by normal checked PR release. This correction creates no new engineering result or database deployment requirement.
