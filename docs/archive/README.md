# docs/archive — dated writing about retired features and finished sessions

Nothing in this folder describes the live system. These files were written between November 2025 and February 2026 about
features that were later deleted (trading, auto-buy, betting, investor portal and SEC compliance, social publishing, shipping,
the November 2025 mobile redesign, payments and receipts generation) or about one-off deployment and fix sessions. The
2026-03-28 stale-docs audit marked them for archiving; they moved here on 2026-10-06 with their original paths kept under
this folder, so `git log --follow` and old links in history still resolve.

Read them as history. For what exists and operates now, start at the repository's `AGENTS.md`, the live `v_schema_atlas`
and `v_job_health` views, and `docs/ledger/README.md`. The capabilities ruled retired are listed in
`docs/ledger/CAPABILITY_MAP.md`.

## Added 2026-11-13

Nine files moved here from the top of `docs/`. Each describes a retired capability, sends the reader to files that are
gone, or was replaced by a current document. Their text is unchanged.

| File | Why it is here |
|---|---|
| `AI_AUCTION_AGENT_FRAMEWORK.txt`, `AUCTION_SYSTEM_FRAMEWORK.txt`, `TIERED_AUCTION_SYSTEM_FRAMEWORK.txt` | November 2025 designs for auctions run on Nuke itself, with an agent that proposed listings for them. The capability map records bidding, auto-buy and trading as retired in March 2026. The agent's function left the repository on 2026-02-01 and is not deployed |
| `TELEGRAM_RESTORATION_INTAKE.md` | Photo intake through Telegram. The capability map records the Telegram bots as retired, and no Telegram function remains in `supabase/functions/` |
| `SOURCES_MASTER_LIST.md` | A readable view of `data/sources/master_sources.yaml`, which is no longer in the repository |
| `ENV_QUICKREF.md` | January 2026 notes on environment variables. It names browser variables the web app no longer reads, and a function and a file that are gone. The current rules for secrets are in `AGENTS.md` |
| `EXTRACTION_READ_FIRST.md` | A reading list whose playbook and status files are gone. The current rules are `docs/EXTRACTION_POLICY.md`, `docs/EXTRACTION_TARGETS.md` and `docs/ACCURATE_EXTRACTION.md` |
| `REPOSITORY_OVERVIEW.md` | A March 2026 overview written under the earlier positioning. The root `README.md` and `docs/architecture/CODEBASE_INVENTORY.md` replace it |
| `YONO_SPEC.md` | A February 2026 placeholder written before any code. The name went to the image classifier, described in `yono/README.md` |

Eleven more files left the top of `docs/` the same day for the folder that fits their kind. They are dated writing about
things that still exist, so they are not in this folder:

| Now in | Files |
|---|---|
| `docs/strategy/` | `NUKE_API_STRATEGY_REPORT.md` and its `.pdf`, `STRUCTURAL_FOUNDATION.md`. `strategy/CONCEPTUAL_FOUNDATION.md` quotes both |
| `docs/research/` | `fb-marketplace-api-analysis.md`, `fb-marketplace-scraper-landscape.md`, `live_auction_protocol_analysis.md` |
| `docs/plans/` | `PLAN_PRIORITIES.md`, `THEME_AUDIT_PAGES.md`, `FUTURE_FEATURES.md` |
| `docs/design-review/` | `DESIGN_REVIEW.md` and `DESIGN_REVIEW_DEEP_DIVE.md`, the two summaries of the reviews in that folder |
