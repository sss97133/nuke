# Cursor Conversation History Reference

## Location
`~/cursor-chat-export/all_conversations.csv` (103MB, extensive history)

## Why This Matters

This file contains **3000+ conversations** about this codebase including:
- Failed approaches that were tried
- Bugs that were fixed (and how)
- Architectural decisions and reasoning
- Data extraction experiments
- Edge cases discovered

## How to Use

When encountering a problem, search this file first:

```bash
# Search for prior discussion of a topic
grep -i "cars and bids" ~/cursor-chat-export/all_conversations.csv | head -50

# Search for past extraction fixes
grep -i "__NEXT_DATA__" ~/cursor-chat-export/all_conversations.csv

# Search for specific errors
grep -i "403 forbidden" ~/cursor-chat-export/all_conversations.csv
```

## Key Topics to Search

Before implementing anything, search for prior work on:
- `__NEXT_DATA__` - Next.js extraction approaches
- `Firecrawl` - API usage, failures, workarounds
- `batch_size` - Timeout issues and fixes
- `KSL` - Why we stopped scraping it
- `image extraction` - What's been tried
- `comments extraction` - Auction comment parsing
- `VIN extraction` - Validation and parsing
- `queue processor` - Lock issues, timeout fixes

## What We've Learned (Summary)

From analyzing the conversation history:

1. **Multi-pass extraction** was discussed but never fully implemented
2. **__NEXT_DATA__ parsing** was attempted but buggy
3. **Batch size issues** caused repeated timeouts
4. **KSL scraping** was abandoned after 3000+ failures
5. **Image backfill** works but is slow
6. **Partial saves** were discussed but not implemented

## Don't Repeat These Mistakes

The conversations show repeated failures from:
1. Not checking what already exists before building new
2. Large batch sizes causing timeouts
3. Ignoring error patterns instead of fixing systematically
4. Building new functions instead of fixing existing ones
5. Not saving partial extraction results
