# Next Session: Build Agent Hierarchy

## Decision: Start with Extraction Workers (Haiku)

Highest ROI - this is your volume work and burns the most Opus tokens currently.

## What to Build

### 1. Haiku Extraction Worker
A simple agent that:
- Pulls URLs from `import_queue`
- Calls existing extractors (bat-simple-extract, etc.)
- Logs results
- Runs on `--model haiku` (cheap)

### 2. Sonnet Supervisor
Manages the workers:
- Monitors queue health
- Handles failed extractions (retries, escalates)
- Reports rollups to you via Telegram bot

### 3. Opus Strategist (You + Claude)
Only called for:
- New source types (no extractor exists)
- Complex debugging
- Architecture decisions

## Commands to Start

```bash
# Launch extraction worker (Haiku - cheap)
claude --model haiku "Process 50 pending items from import_queue. Use existing extractors. Log completions to claude-log."

# Launch supervisor (Sonnet - medium)
claude --model sonnet "Monitor extraction health. Check for stalled queues, high error rates. Report issues."

# You stay on Opus for strategy only
```

## Files Updated This Session

- `~/.claude/settings.local.json` - Full autonomy permissions
- `/Users/skylar/bin/claude-notify` - Telegram notification hook
- `/Users/skylar/bin/claude-log` - Work completion logger
- `/Users/skylar/nuke/agents/claude-checkin-bot/bot.py` - Check-in bot (running)

## Telegram Bot

Running at `@Sss97133_bot` - message it:
- `/status` - what's happening
- `/logs` - what got done
- `/errors` - problems

## Your $200/mo Strategy

- Haiku for extraction (90% of work) → ~$0.25/1M tokens
- Sonnet for supervision → ~$3/1M tokens
- Opus for strategy only → ~$15/1M tokens

This should 10x your runway.
