# Active Agents

*Register yourself when starting. Remove yourself when done.*
*Format: `HH:MM | AGENT-NAME | task description | files/areas touched`*

---

## Currently Active (2026-03-25)

16:30 | BAT-42K-INGEST | Step 3 running in background (PID 69798) — bat-drain-queue.mjs draining ~38.7K remaining BaT URLs at ~10K/hr. Steps 1+2 COMPLETE (28K vehicles + 1.1K enriched). ETA ~8 PM. | bat_extraction_queue, vehicles, vehicle_images

17:45 | NICHE-FEED-ONBOARDING | DONE (Classic Driver 48K background ingest still running — ~20K/48K done, will complete automatically via background node process) | listing_feeds, observation_sources, import_queue

18:00 | DEAD-SOURCE-REVIVAL | DONE — Revived Mecum (18.5K queued via Algolia), Barrett-Jackson (10K+ queued via API), RM Sotheby's (processed 14 auctions), Gooding (9K discovered). New crons: mecum-batch-from-queue, bj-batch-from-queue. Full BJ discovery (63K) still running in background. | import_queue, cron.job, scripts/

---



18:30 | DEEP-EXTRACT-SAMPLES | DONE — 75 vehicles enriched across 11 sources. See DONE.md for details.

$(date +%H:%M) | REVENUE-INFRA | Investigating 3 deal-flow tasks: exchange trade flow, Stripe invoice payment, Stripe Connect onboarding | fund_trades, market_orders, stripe-related functions/pages

DONE | ENRICHMENT-QUALITY-METRICS | COMPLETE — enrichment_quality_report() RPC created, granted, tested via REST API. Task 29814fe7 marked completed.

DONE | BUYER-INTELLIGENCE-P1 | COMPLETE — 343,661 buyer profiles created in mv_buyer_profiles. 8 segments. 4 SQL functions deployed. See DONE.md.
