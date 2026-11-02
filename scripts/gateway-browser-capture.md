# Gateway public browser intake

`gateway-browser-capture.ts` reuses the public browser flow from the earlier dealer
collector, with a new unsigned context and the installed Playwright Chromium. It
captures Gateway inventory and at most 20 detail pages. It does not use a user
profile, login, proxy, paid renderer or model extraction. Publisher JSON-LD on each
detail must establish matching stock identity and an explicit in-stock offer.

Run from a reviewed checkout with existing dependencies and Deno cache available:

```sh
dotenvx run -q -f /Users/skylar/nuke/.env -- deno run \
  --node-modules-dir=none --cached-only --allow-env --allow-read --allow-write \
  --allow-run --allow-sys --allow-net scripts/gateway-browser-capture.ts \
  --limit 20 --receipt-dir /absolute/private/gateway-stage
```

The default stages privately and writes nothing to Nuke. After normal CI deploys
the native intake, add `--land --state-file /absolute/private/gateway-state.json`.
To reuse a staged packet rather than revisit the source, add
`--replay-dir /absolute/private/gateway-stage` and choose a different receipt
directory. Replay retains the original visit clocks, requires source freshness,
and returns without writes if that run already completed.

Landing uses the existing retained-capture helper, `ingest` entity resolution,
`ingest-observation` with analysis deferred, and the existing listing projection.
Asking offers remain asking offers; configuration remains seller testimony. An
unchanged body may reuse its original snapshot while the browser run retains the
new visit clock. Both clocks and the body hash are checked before admission.
The ordinary feed poller consumes only fresh completed browser runs with captured
details. Missing captures produce a blocked status without a paid fallback.

For recurrence, pin a reviewed commit into a private runtime with the installed
`node_modules` available. A local launchd agent may invoke the same command every
15 minutes with one persistent private state file. The script locks that state,
honors the feed's existing revisit interval and live global/source intake limits,
and rotates toward unvisited/oldest-attempted stock. Do not run the old multi-source
collector or change held sources. Keep receipt directories outside the checkout;
do not put credentials in launchd arguments or export them to the browser child.
Disable the agent with `launchctl bootout gui/$(id -u)/ag.nuke.gateway-browser`.

Scope: one inventory page per visit, bounded detail collection. This is not a
source census, complete withdrawal monitoring or proof that all sources are fresh.
