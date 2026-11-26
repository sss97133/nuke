---
id: 2026-11-25_catalog-supply-admission
change_type: data_model
scope: retained catalog source admission and literal package properties
case: docs/ledger/theory/data-machine-cases.md 13.12
---

# Supplied catalog bytes precede package properties

The owner authorized the order, receive/pick, cut and assemble system and the
required database work. This bounded dependency retains original catalog
Markdown through the existing supplied-reference/document owner, then uses
canonical ingest-observation selectors to admit source-specific literal
properties. It does not choose a job, seed a source, assert received stock or
make an electrical or manufacturing decision.

The live atlas and exact writer were inspected before minting. Existing
reference_documents, document_pages and reference-docs storage already own
supplied originals, through index-reference-document supplied_reference and
record_supplied_reference_document. That path is PDF-specific. The new
supplied_catalog_source mode keeps real UTF-8 Markdown under its SHA256 and
text/markdown MIME; it does not feed Markdown into an HTML or PDF capture.
The original claimed capture clock and current database import clock remain
distinct. The original source URL remains an attributed locator; it does not
authenticate the supplier or establish a fresh fetch.

Source facts use the existing observation log. The service-only
catalog_source_document selector qualifies one retained document; the
catalog_supply_property selector names that admitted source, exact catalog
part and original source line. Neither accepts an asserted amount, unit,
supplier authority or child part. The SQL qualifier derives the insert recipe.
A narrow admission guard requalifies the source under row locks, compares the
whole protected claim, and atomically projects the typed catalog_supply_properties
index. Generic intake refuses the protected methods. Supersession and source
changes retain old rows but remove their current qualification. New normalizer
versions can create new interpretations of the same original source without
cloning testimony or overwriting history.

The typed index holds individual source claims, not summable supply. Counts
and lengths remain different units. The current reader explicitly labels all
results purchasing_eligible=false and supplied_document_authority_unverified.
Kit child labels can have literal quantities while their exact child catalog
identity remains unresolved. No whole-kit expansion combines separate captures,
and no corroborating quantity claims are summed. Exact catalog part, catalog
source host, product number, variant URL and property witness must agree.

The supported first grammar is deliberately bounded: one main printed product,
its sale unit, and a literal property within the first Overview section. It
recognizes explicit pack counts, stock lengths and listed kit component counts.
It refuses pricing-break numbers, availability, related-item cards and capacity
phrases such as “4 Way.” Both original strings and normalized units survive.
Unsupported syntax remains unqualified; no model or external fetch runs.

The retained original ProWire source bodies were read from the shared checkout.
An isolated PostgreSQL assay used their exact bytes:
- 8CYLK-90 source SHA256
  73cb42b6879f0703c8aba024782e3871ac2f8a71098f2cfa8f86bd9e65a0842b:
  lines91–93 yield the listed 8 bodies, 8 boots and 1 marker kit; line97,
  a related terminal card, yields no quantity claim.
- COIL-CONN-LS2/7 source SHA256
  7b3b3e20fdf50bebee7e4eaab6a3b19e03ab1ed4c8cffaed2f236e90604dc9b9:
  line88 “4 Way Connector Body” yields no count; lines89–91 retain the
  separately listed 4 seals, 4 terminals and 1 TPA. Child identities remain
  unresolved by those count sentences.

These are retained source statements, not verified current supplier contents or
owner stock. The positive pack6 and four-foot database mechanics are explicitly
synthetic fixtures. The inspected staged MS25171 pack6 cart remains an
unqualified working-source claim; no missing supplier original was invented.

Validation:
- The full source/document/property SQL contract passes in the existing
  isolated PGlite PostgreSQL17.5 runtime. It covers exact units, misleading
  capacities/cards, cross-supplier same-SKU keys, forged scalar/part input,
  changed source between preview and admission, altered bytes/storage,
  source and property retirement, versioned reinterpretation, immutable
  history and narrow grants.
- 28 Deno tests pass, including original supplied-reference unit tests,
  byte preservation (CRLF, Unicode and BOM), invalid UTF-8/NUL/hash refusal,
  caller authority refusal, and both actual HTTP handlers. Handler tests
  mock storage/database only and assert no supplier/model fetch.
- The original-byte PostgreSQL assay passes for both retained source files.
- git diff --check passes. Native PostgreSQL CI is discovered automatically
  from test_catalog_supply_property_admission.sql and remains unrun for this
  uncommitted slice.
- Release transaction check: the migration's final non-whitespace statement is
  COMMIT; matching its opening BEGIN. This was asserted explicitly and the
  focused PostgreSQL contract rerun successfully. Frozen migration SHA256:
  1d3d914fcf257e0298e2541fb7ed0f978e3879db6189b5e8fbad57a02851be7b.

Evidence is retained under
/Users/skylar/nuke-logs/wiring-build-system-20261125/:
package-source-owner-read.json, package-source-capture-read.json,
catalog-supply-contract-pglite.log, catalog-supply-deno.log and
catalog-original-markdown-assay.log. The proposal records the preceding owner
inventory and source-grain constraints.

Remaining source and operating dependencies are explicit: verified supplier
authority, exact child identities, coherent selected package expansion,
job/demand binding, purchasing units, receipt/inspection and physical build
evidence. They are not satisfied by this admission path. The earlier circuit
checks/material-demand candidates still await consolidation into the canonical
persisted evaluation owner; this change creates no second eligibility engine.

Stage: implemented and locally tested for review; no real source imports, seeds,
commits, pushes, native CI run, merge, deployment or live acceptance by this lane.
