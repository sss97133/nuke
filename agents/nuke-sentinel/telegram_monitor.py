#!/usr/bin/env python3
"""
Telegram Monitor for Nuke Sentinel
Uses MTProto API to monitor channels and send alerts.
"""

import os
import json
import asyncio
from pathlib import Path
from datetime import datetime, timedelta
from typing import List, Dict, Optional

from telethon import TelegramClient
from telethon.tl.functions.messages import GetHistoryRequest
from telethon.tl.types import Channel, Chat, User

AGENT_DIR = Path(__file__).parent
SESSION_FILE = AGENT_DIR / "telegram_session"
CACHE_FILE = AGENT_DIR / ".cache" / "telegram_seen.json"

# API credentials
API_ID = os.getenv("TELEGRAM_API_ID", "30178208")
API_HASH = os.getenv("TELEGRAM_API_HASH", "87ba8d78ccf937ea9f581be85f8b58a9")

# Channels to monitor for AI/Claude news
CHANNELS_TO_MONITOR = [
    "AnthropicAI",           # If they have one
    "openaboratory",         # AI research discussions
    "aiaboratoryy",          # AI news
    "claude_ai_news",        # Claude specific
    "theaaboratory",         # AI lab news
]

# Keywords to filter for
KEYWORDS = [
    "claude", "anthropic", "mcp", "opus", "sonnet",
    "claude code", "ai agent", "llm", "grok"
]


class TelegramMonitor:
    def __init__(self):
        self.client = None
        self.seen = self._load_seen()

    def _load_seen(self) -> set:
        CACHE_FILE.parent.mkdir(exist_ok=True)
        if CACHE_FILE.exists():
            with open(CACHE_FILE) as f:
                return set(json.load(f).get("ids", []))
        return set()

    def _save_seen(self):
        with open(CACHE_FILE, 'w') as f:
            json.dump({"ids": list(self.seen)[-5000]}, f)

    async def connect(self):
        """Connect to Telegram."""
        self.client = TelegramClient(
            str(SESSION_FILE),
            int(API_ID),
            API_HASH
        )
        await self.client.start()
        me = await self.client.get_me()
        print(f"Connected as: {me.username or me.phone}")
        return self.client

    async def disconnect(self):
        if self.client:
            await self.client.disconnect()

    async def get_channel_messages(self, channel_name: str, limit: int = 20) -> List[Dict]:
        """Get recent messages from a channel."""
        try:
            entity = await self.client.get_entity(channel_name)
            messages = await self.client(GetHistoryRequest(
                peer=entity,
                limit=limit,
                offset_date=None,
                offset_id=0,
                max_id=0,
                min_id=0,
                add_offset=0,
                hash=0
            ))

            results = []
            for msg in messages.messages:
                if msg.message:
                    results.append({
                        "id": msg.id,
                        "date": msg.date.isoformat(),
                        "text": msg.message,
                        "channel": channel_name,
                        "views": getattr(msg, 'views', 0)
                    })
            return results

        except Exception as e:
            print(f"  Error fetching {channel_name}: {e}")
            return []

    def matches_keywords(self, text: str) -> bool:
        """Check if text matches any keywords."""
        lower = text.lower()
        return any(kw in lower for kw in KEYWORDS)

    async def scan_channels(self) -> List[Dict]:
        """Scan all monitored channels for relevant messages."""
        all_messages = []

        for channel in CHANNELS_TO_MONITOR:
            print(f"  Checking Telegram: {channel}")
            messages = await self.get_channel_messages(channel)

            for msg in messages:
                msg_id = f"{channel}_{msg['id']}"

                if msg_id in self.seen:
                    continue

                if self.matches_keywords(msg["text"]):
                    msg["source"] = "telegram"
                    all_messages.append(msg)
                    self.seen.add(msg_id)

        self._save_seen()
        return all_messages

    async def send_message(self, chat_id: str, text: str):
        """Send a message to a chat/user."""
        try:
            await self.client.send_message(chat_id, text)
            return True
        except Exception as e:
            print(f"  Error sending message: {e}")
            return False

    async def send_digest(self, chat_id: str, items: List[Dict]):
        """Send a digest to a chat."""
        if not items:
            return

        text = f"🔔 **Sentinel Digest** - {datetime.now().strftime('%H:%M')}\n\n"
        for i, item in enumerate(items[:10], 1):
            source = item.get("source", "?")
            if source == "telegram":
                text += f"{i}. [{item['channel']}]\n{item['text'][:200]}...\n\n"
            else:
                text += f"{i}. {item.get('title', '?')[:100]}\n"

        await self.send_message(chat_id, text)


async def setup():
    """Interactive setup - authenticate with Telegram."""
    print("=" * 50)
    print("Telegram Setup")
    print("=" * 50)

    monitor = TelegramMonitor()
    await monitor.connect()

    print("\n✓ Connected successfully!")
    print(f"Session saved to: {SESSION_FILE}")

    # Show some channels
    print("\nLooking for AI channels...")
    for channel in CHANNELS_TO_MONITOR[:3]:
        try:
            entity = await monitor.client.get_entity(channel)
            print(f"  ✓ Found: {channel}")
        except:
            print(f"  ✗ Not found: {channel}")

    await monitor.disconnect()
    print("\nSetup complete! Run sentinel.py to start monitoring.")


async def test_scan():
    """Test scanning channels."""
    monitor = TelegramMonitor()
    await monitor.connect()

    print("\nScanning channels...")
    messages = await monitor.scan_channels()
    print(f"\nFound {len(messages)} relevant messages")

    for msg in messages[:5]:
        print(f"\n[{msg['channel']}]")
        print(f"  {msg['text'][:200]}...")

    await monitor.disconnect()


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "--setup":
        asyncio.run(setup())
    elif len(sys.argv) > 1 and sys.argv[1] == "--test":
        asyncio.run(test_scan())
    else:
        print("Usage:")
        print("  python telegram_monitor.py --setup  # First time setup")
        print("  python telegram_monitor.py --test   # Test scanning")
