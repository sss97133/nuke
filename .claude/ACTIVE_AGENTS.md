# ACTIVE AGENTS - Updated 2026-02-05 01:35

## TELEGRAM SYSTEM V2 - CONFIRMED WORKING ✅

### System Status (verified 2026-02-05)
- ✅ Button approvals working (A9VBTWUA, YGMCFDZ5, etc. all processed)
- ✅ Text approvals working (`REQUESTID yes/no/message`)
- ✅ 10-minute timeout (increased from 5 min)
- ✅ Confirmation messages sent when approval recorded
- ✅ Hook script integrated with Claude Code

### What Was Built
Complete bi-directional Telegram system for:
1. **Claude Code approvals via text** - Reply to permission requests from anywhere
2. **Intelligent query handling** - Natural language queries processed by Claude API
3. **Task queueing** - Complex requests queued and processed async

### New Database Tables
- `claude_approval_requests` - Pending permissions with 10-min expiry
- `telegram_tasks` - Task queue for complex queries
- `telegram_conversations` - Multi-turn chat state
- `telegram_message_log` - Full message history

### New Edge Functions Deployed
- `nuke-telegram-bot` - Unified entry point (webhook target)
- `telegram-task-worker` - Claude API task processor
- `telegram-approval-callback` - Button callback handler

### Local Files Created
- `~/.claude/hooks/telegram-approval.py` - Permission request hook
- `/Users/skylar/nuke/agent/nuke_telegram_agent.py` - Local bot (backup)
- `/Users/skylar/nuke/agent/intelligent_worker.py` - Local task processor
- `/Users/skylar/nuke/agent/TELEGRAM_SYSTEM.md` - Full documentation

### How to Use
- **Quick commands**: `status`, `approvals`, `help`
- **Approve Claude**: `ABC12345 yes` or tap inline button
- **Deny Claude**: `ABC12345 no`
- **Approve with message**: `ABC12345 go ahead and do it`

### Files Modified
- `~/.claude/settings.local.json` - Added PermissionRequest hook

### DO NOT TOUCH
- `~/.claude/hooks/telegram-approval.py` - Active hook
- `telegram_tasks` table - Active queue

---

## EXTRACTION FLEET STATUS

### Running Processes
- **BaT Workers**: ~20+ autonomous workers processing 46K pending BaT listings
- **Playwright Multi-Source**: Extracting C&B, Hagerty, PCarMarket (bypassing Firecrawl)
- **C&B VIN Backfill**: Playwright-based VIN extraction for Cars & Bids
- **Gooding Batch**: Processing 9K+ auction lots
- **RM Sotheby's**: Processing multiple auctions (PA26, AZ26, AZ25, MT25)

### Queue Status (as of extraction start)
- **Pending**: ~46K (mostly BaT)
- **Complete**: ~138K
- **Processing Rate**: ~3K/hour

### BLOCKERS - DO NOT RETRY THESE
1. **OpenAI**: Quota exceeded - affects coordinator only
2. **Firecrawl**: Credits exhausted - use Playwright fallback instead

---

## PHOTO PIPELINE (skylar session - active)

### What I'm Building
- **Telegram intake** → Cloud storage → photo_inbox queue
- **YONO** - Custom YOLOv8 classifier for vehicle ID
- **SMS review** - Low confidence photos trigger tech notification

### New Tables Created
- `photo_inbox` - Fast intake queue (no triggers)
- `photo_training_data` - Corrections for YONO training

### New Functions Deployed
- `telegram-intake` - Simplified, direct to storage
- `sms-review` - SMS-based photo assignment

### Files Modified
- `/Users/skylar/nuke/supabase/functions/telegram-intake/index.ts`
- `/Users/skylar/nuke/yono/` - YONO training pipeline

### Storage
- Bucket: `vehicle-photos` (public)

### DO NOT TOUCH
- `photo_inbox` table
- `telegram-intake` function
- `vehicle-photos` bucket

---

## What's Working
- BaT direct HTML extraction (no API needed)
- Gooding (Gatsby/Contentful API)
- RM Sotheby's (direct API)
- Playwright-based extraction (local browser)
- **Telegram photo upload** (just deployed)

### Extractors by Source
| Source | Extractor | Status |
|--------|-----------|--------|
| BaT | extract-bat-core | ✅ Running |
| Cars & Bids | playwright-multi | ✅ Running |
| Gooding | extract-gooding | ✅ Running |
| RM Sotheby's | extract-rmsothebys | ✅ Running |
| PCarMarket | playwright-multi | ✅ Running |
| Hagerty | playwright-multi | ✅ Running |
| Mecum | needs Playwright setup | ⚠️ Pending |
| Collecting Cars | extract-collecting-cars-simple | ⚠️ Not queued |

---

## Scripts to Monitor
```bash
# Check queue status
PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c "SELECT status, COUNT(*) FROM import_queue GROUP BY status;"

# Check photo inbox
psql ... -c "SELECT source, COUNT(*), COUNT(*) FILTER (WHERE processed) as done FROM photo_inbox GROUP BY source;"

# Check active workers
ps aux | grep -E "(autonomous-bat|playwright|extract-)" | grep -v grep | wc -l
```

### Next Steps for Other Agents
1. Continue BaT processing (auto-running)
2. Monitor Playwright extraction progress
3. Don't restart Firecrawl-dependent extractors - use Playwright
4. **Don't modify photo pipeline tables/functions** - active development
