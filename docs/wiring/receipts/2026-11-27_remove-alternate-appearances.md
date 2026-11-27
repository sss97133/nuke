# One paper appearance for wiring

Change type: presentation simplification. Remove the shop, CAD and ledger appearances and their selection controls from the wiring workspace and connector inspector. The paper presentation remains the shared rendering style. Retired `cw` URL parameters are removed while other navigation and record-selection parameters remain intact. Stored alternate-colour preferences no longer affect either reader.

This supersedes the earlier four-appearance interface direction. It changes no source records, physical wire colours, checks, worksheets or diagrams' electrical meaning. No new engineering or purchase conclusion is generated.

Unknowns: none for this bounded removal.

Verification: 17 existing schematic/schedule tests pass; enforced repository gate (including frontend typecheck/build) passes. A fresh anonymous browser with each old stored preference and matching `cw` link loads the physical wiring model in the paper presentation, with zero appearance selectors, zero page errors and the selected connector/navigation preserved. The schedule still offers its Excel download. Normal checked PR release and live verification apply. Full order-to-assembly acceptance remains open.
