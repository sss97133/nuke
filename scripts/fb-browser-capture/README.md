# Local Marketplace capture producer

This deterministic Chrome MV3 producer feeds the existing `scripts/fb-import-urls.ts` and canonical `extract-facebook-marketplace` browser-capture owner. It reads rendered vehicle cards in one dedicated, extension-created Marketplace tab. It does not adopt other tabs, use page-world/hidden state, extract credentials/cookies, invoke inference, or contact another source. Original displayed text, accessibility label, image URL/alt witnesses, displayed filters, region and capture clocks travel in the immutable packet. Source listed time remains unknown; Sold/Pending are attributed displayed labels, not confirmed vehicle sales.

Initial installation is **disabled**. The popup provides Start/Resume, Pause, Run-if-due and status. Default source cadence is 15 minutes, at most96 cycles per rolling24 hours, at most4 viewport scrolls and200 newly read cards per cycle. Priority1960–1990 changes order only; encountered newer/unknown cards are retained. Each cycle splits into immutable packets of at most50 cards with a shared source-cycle ID. The unvisited tail is unknown. Repeated query visits are genuine new source attempts; repeating a pending packet is only landing replay. Dedicated older-detail revisits are not implemented.

## Reviewed local installation

No browser policy or Codex extension/settings changes. Chrome's normal **Load unpacked** action is required; if the computer-use surface refuses privileged browser URLs, the owner performs that UI action. Do not work around that restriction.

1. From this pinned checkout, prepare the user-local native host:
   `node --import tsx scripts/fb-browser-capture/install-host.mjs`
2. In Chrome's Extensions management page, use normal Load unpacked and select this checkout's `scripts/fb-browser-capture/extension` directory. The public manifest key fixes ID `aidnmhdaljkomnocelhkcgogjonkjafi`; no private signing key is retained. The host accepts only that origin.
3. Open this extension's toolbar popup and click **Start / Resume**. It first checks the native host, then creates its own source tab. Pause remains available. Installation alone starts no source work.

The installer targets macOS user-local Chrome only. It checks pre-existing config/manifest ownership before replacing anything, leaves the immutable spool intact, fixes the executable PATH, and invokes installed Node/dotenvx with argument arrays. Existing credentials are read only by the existing CLI from the owner's established Nuke environment, never by browser code. Native commands are only ping and bounded capture packets; there is no shell command/path input, HTTP listener or tunnel.

Private packets/ACKs live in `~/nuke-logs/provenance-development-2026-10-11/fb-browser-continuity/captures`. The host preserves immutable packet bytes and CLI receipts, validates capture ID/clock and all raw/listing/sighting ACK counts, and caches a verified ACK. Exact replay reuses the same capture; changed testimony with an old ID is refused. Dead native-host locks recover without changing the packet. Browser local state retains up to8 pending packets; host refuses more than8 unacknowledged packets. ACKed originals are retained, not silently deleted.

Pending landing blocks new source work. Transient failure retries the same packet after1/2 minutes, at most3 attempts, then pauses for explicit Resume. Login/challenge/scope/load failures pause immediately with visible status. Queue and source limits are independent. Chrome worker sleep/reload preserves queue; browser startup clears the tab association and creates a fresh owned tab rather than adopting a user tab. Source-attempt interruptions and late scheduling are recorded, never counted as completed capture. The host/browser must remain available; alarms do not wake a sleeping machine. No continuous-availability, all-day operation or source-wide enumeration claim follows from this implementation.

## After custody: what the writer connects

The ACK covers custody only (raw packet, listing row, sighting). The same request then connects each landed listing (`supabase/functions/extract-facebook-marketplace/integrate.ts`); its counts are returned as `integration` and kept in the capture's `fb_sweep_jobs.metadata.integration`. A failure there never undoes the ACK.

- Facts are read from the card's own `content_text` (`listingFacts.ts`): title identity, the listing page's "About this vehicle" lines, seller counts and badges, the listed label and the listing's own gallery. Absent lines stay absent.
- A listing whose title states year, make and model goes through `ingest` (`enrich: false`): a `discovered` vehicle or a match, merge proposals for year/make/model candidates, and the classified listing event the Sources and market boards read. No model means it stays unresolved in `marketplace_listings`.
- Linked listings get their listing event at the capture clock, a city-grain `vehicle_location_observations` row (the `/atlas` map), and photo copies through `backfill-images` (no image analysis). A revisit's removal ends the event; it is never a sale.
- The listing page runner sends `seller_profile_url` (the seller block's Marketplace profile link) and leaves out photos inside links to other items. The numeric id becomes an `external_identities` row (`platform 'facebook'`, no display name); the name stays in `marketplace_listings`, which anonymous readers cannot read.

## Focused validation and live acceptance

Use installed dependencies: `node --import tsx --test scripts/fb-browser-capture/collector.test.mjs`.

Fixtures prove rendered-card parsing/unknown asking values/status attribution, role=main scope and recommendation exclusion, origin/command/path rejection, immutable replay and failed-landing retention, pending/source budgets, dead-lock recovery, minimal native PATH, scheduled retry without a new source visit, Pause races, and install/restart queue preservation. They do not fabricate or submit production observations.

Live acceptance is separate: actual unpacked installation/native connection; actual source packets and canonical ACKs; a later scheduled cycle without a model directing steps; intentional worker/reload interruption and queued resumption; existing `db-stats?intake=listing_history` reader inspection. Record implemented/tested/installed/operating/merged independently. An interrupted source read before a packet is staged is a visible gap, not retained testimony.

Primary implementation references: [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [alarms and sleep/persistence](https://developer.chrome.com/docs/extensions/reference/api/alarms), [unpacked installation](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world), [manifest public key](https://developer.chrome.com/docs/extensions/reference/manifest/key), [Chromium ID derivation](https://chromium.googlesource.com/chromium/src/+/main/components/crx_file/id_util.cc).
