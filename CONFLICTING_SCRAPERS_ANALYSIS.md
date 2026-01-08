# ⚠️ CONFLICTING SCRAPERS ANALYSIS

## Active Supabase Cron Jobs (Conflicting with Orchestrator)

### **Currently Active:**
1. **`process-import-queue-manual`** - Every 1 minute
   - Calls: `process-import-queue` (BROKEN - BOOT_ERROR)
   - Batch: 10 items
   - **STATUS**: ❌ Broken, will fail every time

2. **`process-bat-queue`** - Every 1 minute  
   - Calls: `process-bat-extraction-queue`
   - **CONFLICT**: Orchestrator also calls this

3. **`go-grinder-continuous`** - Every 1 minute
   - Calls: `go-grinder` 
   - **CONFLICT**: Orchestrator triggers `sync-active-auctions` (which also uses go-grinder)

4. **`daytime-extraction-pulse`** - Every 10 minutes (8 AM - 7 PM)
   - Calls: `process-import-queue` (BROKEN), `process-bat-extraction-queue`, `go-grinder`
   - **CONFLICT**: Orchestrator runs every 10 min and does same things

5. **`overnight-extraction-pulse`** - Every 3 minutes (8 PM - 7 AM)
   - Calls: `process-import-queue` (BROKEN), `process-bat-extraction-queue`, `go-grinder`
   - **CONFLICT**: Orchestrator runs every 10 min and does same things

6. **`sync-active-auctions`** - Every 15 minutes
   - Calls: `sync-active-auctions`
   - **CONFLICT**: Orchestrator also triggers this

## GitHub Actions (Also Running)

1. **`pipeline-orchestrator.yml`** - Every 10 minutes (NEW)
   - Calls: `process-import-queue-fast`, `process-bat-extraction-queue`, `sync-active-auctions`, `extract-all-orgs-inventory`
   - **CONFLICT**: Duplicates Supabase cron work

2. **`bat-scrape.yml`** - Every 6 hours
   - Calls: `go-grinder`
   - **OK**: Infrequent, not conflicting

3. **`bat_local_partners_inventory.yml`** - Daily at 7 AM UTC
   - Calls: `process-import-queue-fast` (6 batches)
   - **OK**: Daily only, different purpose

## Problems

1. **Multiple jobs calling broken `process-import-queue`** - Wasting resources, failing every time
2. **Queue processors called every minute** - Causing contention, potential race conditions
3. **`go-grinder` called every minute** - Could overwhelm BaT
4. **Orchestrator duplicates existing work** - Redundant processing

## Solution Options

### Option A: Disable Supabase Crons, Use Orchestrator Only (RECOMMENDED)
- **Pros**: Single source of truth, no conflicts, better coordination
- **Cons**: Need to ensure orchestrator is reliable
- **Action**: Disable conflicting Supabase cron jobs

### Option B: Keep Supabase Crons, Orchestrator Only Unlocks & Scrapers
- **Pros**: Multiple processing paths (resilient)
- **Cons**: Still have conflicts, waste resources
- **Action**: Modify orchestrator to skip queue processing, only unlock + trigger scrapers

### Option C: Consolidate Everything into Orchestrator
- **Pros**: Complete control, no conflicts
- **Cons**: Single point of failure
- **Action**: Disable all Supabase crons, orchestrator handles everything

## Recommended: Option A
Disable conflicting Supabase crons, use orchestrator as single source of truth.

