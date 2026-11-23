# Explore feed signals (DRAFT, NOT APPLIED)

- `001_feed_signals.sql` adds the table `feed_signals` and its only writer, `record_feed_signals(p_events jsonb)`.
- `revert_001_feed_signals.sql` drops both.

The iOS app already queues these events on the phone (`ExploreSignals.swift`). It uploads only when the
UserDefaults flag `explore.signals.upload` is true, and that flag is off by default. Nothing is sent until this draft is
applied and the flag is turned on.

Nothing here is applied. The next steps need the owner's explicit yes:
1. Apply as a migration.
2. Run the contract test.
3. Turn on the flag.

The ranking reader comes after that. It would weigh more/less/hide choices, dwell time and swipe depth by make, model and price band to order
`classified_ask_board`. That reader is not drafted yet.
