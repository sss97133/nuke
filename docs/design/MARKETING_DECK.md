# THE MARKETING DECK — influence precedes interaction

*Split out of the product storyboard 2026-06-10 per Skylar: "influence precedes
interaction is a separate deck — it's basically the marketing deck." The product
storyboard (storyboard-v3.html) covers hit-the-ground-running; this deck covers
everything that happens BEFORE the App Store. Constraint C1 in CONSTRAINTS.md governs.*

## The premise

By the minute a person finds the App Store page they are already convinced or they
are not. The 0.05-second test: the UI is the moment a user picks their favorite
character in a fiction — Dostoevsky had 500 pages to earn that pick; we have a
glance. This deck designs the glance.

## The three doors (moved from storyboard v2, F0)

1. **The shared receipt (iMessage).** A builder texts a day-receipt link. The grey
   bubble is the most trusted UI on earth — a person you know, talking plainly. The
   link card under it must render the receipt (date · count · vehicle), not a generic
   site card.
   - ORGANS: per-day OG card renderer — **does not exist** (audit-verified); the
     `/journal/:date` route currently 404s in prod. Both are launch gates for this
     door.
2. **The agent referral.** "How should I track my resto work?" → the agent has
   already read the substrate via mcp-connector (~50 live tools) and recommends with
   evidence. The one door checked by a machine before a human sees it.
   - ORGANS: mcp-connector LIVE. Fix the deck/board tool names to verbatim-real
     tools (`describe_platform`, `project_work_log`, `submit_vehicle_event`) or
     expose `get_user_day_receipt` on the connector before submission.
3. **The App Store page.** Per APP_STORE_LISTING.md (name, subtitle, six frames,
   review notes). The screenshots must be re-shot from v3 frames with real substrate.

## Door instrumentation

Each door carries a distinct slug/referral param. Which door a user came through is
the first datum we hold about them (constraint C2) — the only marketing analytics we
run.

## To design (not started)

- The Door-1 landing surface: what the texted link opens in Safari, and its single
  visible path to the App Store (the highest-traffic, highest-trust tap in the whole
  funnel — currently a hole).
- The early-adopter list: who gets the soft-launch invitations. The relationships ARE
  the launch budget. Skylar picks the people; this deck only structures the artifact
  they receive (a receipt link, not an ad).
- The press/agent kit: for agents, the kit is the MCP endpoint + one example
  transcript. For humans, one PDF receipt. No brand film. McMaster does not have one.
