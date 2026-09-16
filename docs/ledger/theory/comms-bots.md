# COMMS & BOTS — theory card

**The model:** Comms is a thin OUTBOUND projection layer, not a subsystem of its own: facts/events land in the DB first, and a message (email, notification row, SMS) is a projection of that stored evidence — never a parallel store of truth. All real email goes out through Resend via three small edge fns; user-facing alerts are plain rows in one table the FE polls. ~80% of everything named "bot/sms/telegram/notification" in this repo is DEAD — this lane is mostly a graveyard you must not disturb.

**The invariant(s):**
- `user_notifications` is the ONLY notification table the frontend reads. Five look-alike tables (`notifications`, `notification_events/preferences/templates`, `duplicate_notifications`) are 0-row corpses — writing there = silently lost messages.
- Label-as-projection-of-measurement: store the underlying event with `(source, method, observed_at, trust)`; compose the human-facing message at send/render time. Never bake message categoricals into schema (that's how the notification_* quintet died).
- Telegram/bots capability is RETIRED. The old map's "@Sss97133_bot running" claim is FALSE. Never revive telegram-* ×6 or nuke-data-bot/tech-bot/nukeproof-bot/nuke-mini.
- ⚠ zombies (deployed, source deleted from repo): recover source from git history before touching; NEVER run a "clean up missing functions" sweep.

**Canonical entrypoints:**
- User notification → INSERT into `user_notifications` table (no edge fn; `create-notification` is a zombie)
- Admin notification → `admin_notifications` table
- Reply to inbound email (admin inbox UI) → `reply-email` edge fn (Resend; maps *@nuke.ag from-addresses; updates `contact_inbox`)
- Inter-agent / role email → `agent-email` edge fn (actions: send/inbox/thread/sent; role→@nuke.ag map; direct postgres, `prepare:false` for pgBouncer)
- Invoice email → `send-invoice-email` edge fn
- Transaction SMS → `send-transaction-sms` ⚠ (live FE path but source deleted — restore from git FIRST; all other sms-* are dead)
- Outbound webhooks → `webhooks-manage` — REGISTRATION ONLY; delivery is dead and `webhook_endpoints`/`webhook_deliveries` tables DO NOT EXIST (half-capability)
- Conversational DB access → `mcp-connector` edge fn (prod /mcp per vercel.json; nuke-data-bot was folded into it 2026-03-20)
- Concierge → EXTERNAL repo `/Users/skylar/lofficiel-concierge` — never mint concierge code inside nuke

**Do NOT:** resurrect telegram-*, the bot quartet, inbound-email, gmail-alert-poller, send-inquiry-notification, x-post/instagram fns, webhooks-deliver, or transfer-email/sms-webhook; create a new notification/preferences/templates table; build webhook delivery without a design decision (its tables don't exist); rebuild bot logic outside mcp-connector; draft client communications for Skylar (surface substrate; he sends).

**Before you build here:** read `docs/ledger/CAPABILITY_MAP.md` §COMMS & NOTIFICATIONS (column 2 = the entrypoint, column 3 = the graveyard) and `docs/ledger/ledger.json` (subsystem COMMS_BOTS) before minting ANY fn/table; check `supabase/functions/CLAUDE.md` for DB write rules; confirm a "missing" deployed fn isn't a ⚠ zombie before deleting.
