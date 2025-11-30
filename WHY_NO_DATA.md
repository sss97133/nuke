# Why Data Isn't Coming In

## The Problem

✅ You have excellent scraping functions:
- `scrape-vehicle` - Works great
- `scrape-squarebody-inventory` - Ready to go
- `scrape-vehicle-with-firecrawl` - Bypasses 403s
- `extract-vehicle-data-ai` - AI extraction

❌ But nothing is triggering them:
- No cron jobs scheduled
- No automated triggers
- Missing database tables (bat_scrape_jobs)
- Functions exist but aren't being called

## The Fix

You need to actually START the scraping. Options:

1. **Manual trigger** (test first)
2. **Cron job** (automated)
3. **Scheduled function** (Supabase cron)

