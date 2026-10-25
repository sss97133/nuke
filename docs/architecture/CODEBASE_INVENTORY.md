# Codebase and product inventory

Source baseline: `29c02a326`, inspected 2026-10-25, with the accounting-office working changes. This is a coverage map, not a claim that every feature works in production. Runtime observations below precede deployment of this change.

## Reproduce the inventory

Use the existing ledger tool and installed frontend dependencies:

```sh
node scripts/ledger/refresh-facts.mjs --codebase --out /path/outside/repo/codebase-inventory.json
node --test scripts/ledger/codebase-inventory.test.mjs
```

This mode is offline. The JSON records every tracked file, registered literal route, owner/component, guard, transitive source dependencies, static backend call names, page reachability, direct-import tests and unmatched literal navigation candidates. It deliberately marks runtime, data correctness and action flow `not_assessed`. Source indexing is not a live API probe. Untracked additions enter the denominator after staging.

| Source coverage | Baseline |
|---|---:|
| Tracked files | 11,105 |
| Frontend JS/TS modules | 1,603 |
| Registered routes, including storefront | 215 |
| Page routes / redirects / routers / fallback | 187 / 20 / 7 / 1 |
| Non-test TSX files under `pages/` | 281 |
| Direct route owners / imported support / no static entrypoint found | 149 / 119 / 13 |
| Detected signed-in guards / admin guards / no route guard detected | 53 / 45 / 117 |

All 215 routes and 281 page sources are indexed. Manual source review concentrated on settings, profile connections, developer docs, vehicles/garage/photos, invoices, receipt review and work. Production UI was sampled on **4 registered paths** (`/settings`, `/invoices`, `/receipts/unlinked`, `/work`), plus the unregistered `/settings/webhooks` destination. The other **211 registered routes were not runtime-assessed in this lane**. Neither rendered records nor route guards establish data correctness or server authorization. Private per-route coverage receipts retain that distinction.

## Existing owners to extend

| Product boundary | Existing source owners | What to verify next |
|---|---|---|
| Route composition | `App.tsx`, `DomainRoutes.tsx`, `routes/modules`, `storefront/StorefrontApp.tsx` | Guard behavior, deep links, storefront host differences |
| Accounting office | `pages/publishing/FinanceDashboard.tsx`, `components/finance/FinancialWorkpapers.tsx`, accounting service/readers | Evidence → line item → vehicle/job/source; uncertainty and correction paths |
| Invoices | `pages/InvoiceManager.tsx`, `send-invoice-email`, `create-work-order-invoice-checkout` | Distinguish legacy generated invoices from sanctioned work-order invoices; recipient/line-item provenance before delivery |
| Receipts/photos | `pages/UnlinkedReceipts.tsx`, `PersonalPhotoLibrary.tsx`, `usePhotoLibrary`, library services | Resolve failed extraction, duplicate-looking evidence and missing amounts without overwriting testimony |
| Work and providers | `pages/jobs/WorkPage.tsx`, `JobPage.tsx`, `jobsReaders.ts`, `pages/providers`, `pages/provider-setup` | Every queue item needs a supported next step and an explicit meaning for signatures |
| Vehicle workspace | `pages/vehicle-profile`, `components/garage`, `useVehiclesDashboard` | Parts, receipts, job evidence and ownership must stay connected |
| Market/discovery | `HomePage.tsx`, `feed`, `pages/market`, `Search.tsx`, `BrowseVehicles.tsx` | Empty/error/loading states and responsive card/read-path coverage |
| Account/settings | `SettingsHubPage.tsx`, `UserProfile.tsx`, `Capsule.tsx`, settings pages | Actionable destinations; access/provider status distinct from subscriptions |
| Shared design | `styles/unified-design-system.css`, `kit`, `components/ui`, layout | System typography, target size, focus, both themes, phone/tablet/desktop |
| Data machine | `supabase`, `scripts`, `docs/ledger/theory` | Live atlas/job-health evidence; sanctioned intake/fold boundaries |

Directory scale: `supabase` 3,728 files; `scripts` 2,691; `docs` 1,994; frontend 1,968; `apps` 368. Native apps already exist alongside the web product. A Rust rewrite has no evidence-based role in repairing the navigation, evidence connections and incomplete actions found here.

## Findings and bounded repairs

| Priority | Evidence | Work in this change / remaining work |
|---|---|---|
| P0 | Accounting needs explainable accuracy and evidence drill paths | Accounting owner implements the office/evidence workflow separately; this inventory does not certify books or filing readiness. |
| P1 | Settings connections action had no effect; Webhooks went to “No such page” in production | Settings now groups real destinations, links to the own-profile connections drawer and includes AI access. Unsupported webhook configuration is described honestly. |
| P1 | Cancelled invoices exposed payment buttons; SEND only changed a status; preview actions were placeholder alerts | Closed/paid invoice actions are guarded, invalid payment input is rejected, “Mark as sent” explains its effect, and unavailable delivery/PDF/export remains visible but disabled with a reason. Read failures no longer look like an empty list. |
| P1 | Invoice date-only values displayed the previous day in Pacific time | Calendar-day display corrected and tested; no invoice data changed. |
| P1 | “From my photos” and “Legacy View” pointed to an unregistered route | Active photo library and garage are linked; saved photo-entry route redirects to the photo library. Dormant legacy writers remain dormant. |
| P1 | Work queue sample contains photo-derived confirmation items without a job/action link | Locate and connect the sanctioned work-day confirmation path. No signature or payment was executed. |
| P1 | Receipt review renders sources/vehicle links but unresolved extraction and missing values have no in-page repair action | Connect review to sanctioned evidence intake/supersession. Displayed amounts remain unverified. |
| P2 | Static navigation scan still identifies candidates in diagnostic, Dropbox callback, market portfolio and admin settings pages | Classify against server handlers/downloads and route history before changing. A static mismatch alone is not proof of a broken capability. |

`send-invoice-email` already accepts a structured recipient, invoice details and line items; the current invoice page does not collect all of those inputs. It must be integrated with the appropriate authority and reviewed payload, not invoked by relabeling a button. QuickBooks connection and work-order checkout are different capabilities; neither proves generated-invoice export exists. PDF generation remains unverified. No new backend was minted for these gaps.

## Evidence and limits

- Inventory fixture: nested routes, guards, lazy/aliased imports, redirects, source calls, reachability, test ownership and link candidates.
- Focused frontend tests: settings destinations, own-profile query-driven drawer, closed invoice actions, invalid payment inputs, explicit unavailable actions, failed-read state and calendar dates.
- Synthetic browser fixture: actual InvoiceManager with a mocked read-only client, 390px width, both themes; controls measured 44px and no horizontal overflow. This is layout/interaction evidence, not live financial validation.
- Shared shell and accounting verification have their own release receipts. Merge, deployment and post-deployment runtime checks must be recorded by the release owner.
- Thirteen page sources have no statically found entrypoint. Keep them until ownership/usage is assessed; this is not a deletion list.
