#!/bin/bash
cd "$(dirname "$0")"
source venv/bin/activate
cd /Users/skylar/nuke && dotenvx run -- python3 /Users/skylar/nuke/agents/nuke-sentinel/telegram_bot.py
