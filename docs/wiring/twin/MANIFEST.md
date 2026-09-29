# Twin engine bay v3 — sources, downloads and licences

Nothing in the repo is a maker CAD file or a maker image; those stay in `~/k5-harness-pull/cad/` (not committed). The
committed geometry (v3 parts, the GLB) is our own, built from the published dimensions below.

## 3D models looked for (no account, no credentials)

| Source | What | Licence | Used? |
|---|---|---|---|
| Thingiverse thing:1911808 "Chevy Camaro LS3 V8 Engine - Scale Working Model" (ericthepoolboy), modelled from CAD/specs | scale LS3 (block, heads, intake…) | CC BY-NC 4.0 (page JSON-LD) | **No**: `/thing:1911808/zip` returned the site's JS page, not a file, and BY-NC forbids the public GLB anyway |
| Thingiverse thing:3920658 "LS3 Direct to head inlet manifold" | intake | not checked | No |
| Printables 60655 "LS3 Yellow Bird" | display model | download needs a login | No |
| GrabCAD / Cults3D / Sketchfab | LS3 CAD | login required | No |
| TurboSquid 1978 Chevrolet Blazer (already in v2) | body, frame, wheels | TurboSquid licence, in the private .blend only | Yes, untouched (never exported) |

## Documents used for dimensions and placements (kept under `~/k5-harness-pull/cad/` or already in `reference_documents/`)

| Doc | Where | Used for |
|---|---|---|
| GM Powertrain "LS3 6.2L V8 Marine Engine" 2009 spec sheet | `reference_documents/component_drawings/Marine_LS3_6.2L_Specs.pdf` p3 | bore centre 111.76, bore×stroke 103.25×92, envelope 710 L × 716 H × 705 W |
| GM LS block architecture (deck 9.240 in, cam 4.914 in, 90°) | GM published block spec (widely reprinted; URL not fetched tonight) | deck height, cam height |
| Holley 199R10690 "GM LS Street Single-Plane Intake Manifold Kits" (300-131/132/136/137) | `cad/holley_ls_street_single_plane_199r.pdf` (documents.holley.com/858dcc6c…pdf) | pad height 5.42 in above the valley flange, 4150 flange, port 2.50×1.15 in, 3/8 NPT vacuum port |
| Holley 199R11485 "Complete Holley Mid-Mount Accessory Drive Kit" (20-180…20-205) | `cad/holley_midmount_complete_kit_199r11485.pdf` and `reference_documents/component_drawings/Holley_Mid_Mount_Accessory_Drive_Kit.pdf` | kit contents (LT1-style hairpin alternator 197-30x, Type II PS pump, SD7, BANDO 6PK1715, SFI damper), heater-hose options |
| Holley 199R10606 rev7 accessory-drive fitment guide | `cad/holley_accessory_drive_fitment_199r10606rev7.pdf` | (older bracket kits; not the mid-mount) |
| Holley 199R12431 "6L80/6L90E Transmission Control 558-499" | `reference_documents/component_drawings/Holley_6L80_6L90_Transmission_Control_558-499.pdf` | "Main Transmission Connector – Located on the passenger's rear side of the transmission" |
| MoTeC LTCD user manual | `reference_documents/component_drawings/motec_ltcd_user_manual.pdf` | sensor angle 10–90° to vertical tip-down, not vertical, ≥1 m from the ports (recommended), 850 °C continuous; LTC max ambient 100 °C, internal 125 °C, holes 32 mm |
| lsenginediy.com "GM Gen III LS PCM/ECM: Crankshaft and Camshaft Signals Guide" | `cad/lsenginediy_signals.html` | CKP "mounted in the block above the starter"; "All Gen IV 24x and 58x engines have a camshaft position sensor in the front timing cover" |
| Delmo Speed "Del-Stributer" product page + 7 product photos | `cad/delstributer.json`, `cad/delstrib/*.jpg` (© Delmo, reference only) | coil cluster location (rear centre, above the bellhousing); order #5068 in Gmail (bought 2025-11-03) |
| Mitchell FR-88 1988 Blazer 4WD frame sheet | `reference_documents/k5_factory_docs/1988_Blazer_4WD_Frame_Dimensions.pdf` | motor-mount bolt tips 448 mm from centreline (lateral only; stations are point-to-point) |
| Vehicle photos IMG_6531/6530/6532 (2026-01-31, iPhone 15 Pro, 24 mm eq.) | `vehicle_images` rows for e08bf694…, copies in `~/k5-harness-pull/ref-photos/` | as-built truth: intake, TB, rails, covers, mid-mount sides, iBooster, gold panel |
| `vehicle_build_manifest` (DB) | query in HANDOFF | TB 12699160 (92 mm), coils D510C ×8, starter DFSR-8715, LSU 4.9 ×2, knock 12623730 ×2 |

## Web access notes

holley.com product pages return 403 to curl; documents.holley.com PDFs are fine. Summit's static PDFs sit behind
Incapsula. DuckDuckGo's HTML endpoint returned its homepage; Bing had no result for "Holley 300-129". All fetches were
≥10 s apart per host.
