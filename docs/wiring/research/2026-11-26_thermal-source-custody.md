# Database custody for thermal-source review

Observed 2026-11-26. Canonical supplied-document intake, retained public byte hashing, replay and exact qualified page readback all passed. Source custody does not establish vehicle applicability or an engineering result.

| Source | Database document and revision | Reviewed PDF pages |
|---|---|---|
| [MoTeC PDM manual, PN63029 October2021](https://assets.motec.com.au/strapi/PDM_User_Manual_3a926f869d.pdf) | `1d90b4f3-1d6b-40dd-ac58-b5bd0d5e9607`; `b818670133f8faa964e6ec0a53c078a2136465d8cfa86bfa70db2c6880a4ab94` | 3;38 (printed35);51 (printed48) |
| [ABYC E-11 2008 excerpts hosted by Paneltronics](https://www.paneltronics.com/images/technical/E11Excerpts.pdf) | `e0e19c7b-54c3-47cc-8845-7fb9e55e618c`; `15218da5d3694aea9cc46b2624c68427ea3e2b152a638472fd1f3453fbdce6ca` | 1;8;9;12;18;19;20 |

MoTeC wire-table page: `5b962e61-ab64-44d3-855c-bd77c05997e9`. ABYC scope pages: AC clause9=`dd7c4094-1c27-4e46-a583-86547c06a11a`; DC location8=`bec813fa-ffc7-45ae-ba4e-8c4c81cc44a8`; bundle clause12=`3fce9628-c8d1-4d78-85c8-fad8be2c1f4b`; tables18/19/20=`90298ed5-8521-4fd4-b4c5-84d0d064fa4c` / `17378a63-6ecb-4392-92d2-562100d654be` / `3d1605d4-80fc-4fba-a3ec-d19a09bccc0f`.

MoTeC SHA256: `fc99c1dee1ea5336806d070b53a115127d153c6cf3cb9f7759b8fce6314c251e`. Its existing legacy document `56c45b04-1886-47d6-8410-be53f1362675` retains a truncated hash and no qualified source custody. Both records refer to the same bytes; do not count them as independent witnesses. The contents says Wire Specification47 while the actual table is printed48/PDF51; use the retained page identity.

ABYC excerpt SHA256: `111c385b91a8f18ed20a44ca6ded5d01dcbeb748d8faa044eceeee67695fac91`. This is a historical marine reference, with no finding that it is current or controlling for this motor vehicle. ProWire's separate free-air PDF could be viewed through the web reader but direct byte retrieval returned403; no PDF custody or property admission is claimed for it.

Reproduce the qualified read with `SELECT reference_document_evidence('<document UUID>');` under its existing service-only access, then read the exact `document_pages` IDs. Private operator receipts: `manufacturer-references/intake/thermal-custody-runtime-receipt.json` and `thermal-custody-database-readback.json` in the wiring coordination logs. No source values or public grants were changed.
