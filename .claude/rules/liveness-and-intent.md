# Liveness and intent

Three rules that keep the owner out of the review loop. Each one is a scar with a date.

## 1. Unwired is not dead. Deletion is the owner's call.

A component, table or function nothing references today is not evidence it is unwanted.
The fix for a broken surface is to wire or deploy what is behind it, never to remove it.
Only the owner declares a feature dead.

> 2026-07-12: two components were deleted on "unrendered = dead" logic. Both were wanted, and both were restored.

## 2. Intent is captured at Sign, never inferred from an ambient action.

Pasting a URL, hovering, a debounce firing, a file landing in a folder: none of these is user intent.
Nothing that commits user substrate (creates a vehicle, files ownership, attributes a discovery, accrues
value) may run off an ambient trigger. It runs at an explicit submit or confirm, the Sign tier. Every field
goes Decode, Observe, Deliberate, Sign, and only Sign reaches the user's world.

> 2026-07-12: an ingest change wired vehicle creation to a 1 s paste debounce. It would have minted the
> owner's own car as a stranger's "discovery" and discarded the title scan and queued photos. Adversarial
> review caught it before it shipped.

## 3. Lists are hypotheses. Verify against runtime before you act.

Any list of "safe to delete", "dead" or "archivable", including those in `docs/ledger/`, was true when
written at best. Before acting on it, re-verify each item against the live system: `count(*)`, active crons,
`git grep` for callers, the deploy list. `npm run ledger:facts` refreshes the facts layer and prints drift.

> 2026-07-12: of 33 tables ruled "safe to archive", about 23 held live data, one was drained by an active
> cron and one was live config. Four functions ruled dead were deployed and invoked. Re-verification caught
> all of it, and nothing was lost.

The pattern behind all three: the system is the source of truth about the system. Docs and verdicts are
testimony about it. Cite them, then check them.
