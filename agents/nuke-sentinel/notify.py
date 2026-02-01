#!/usr/bin/env python3
"""
Notification handlers for Nuke Sentinel
Supports: Telegram, Supabase, local file
"""

import os
import json
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

AGENT_DIR = Path(__file__).parent


class TelegramNotifier:
    """Send alerts via Telegram bot."""

    API_URL = "https://api.telegram.org/bot{token}/sendMessage"

    def __init__(self, bot_token: str = None, chat_id: str = None):
        self.bot_token = bot_token or os.getenv("TELEGRAM_BOT_TOKEN")
        self.chat_id = chat_id or os.getenv("TELEGRAM_CHAT_ID")

    def is_configured(self) -> bool:
        return bool(self.bot_token and self.chat_id)

    def send(self, message: str, parse_mode: str = "HTML") -> bool:
        """Send a message to Telegram."""
        if not self.is_configured():
            print("  Telegram not configured (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)")
            return False

        url = self.API_URL.format(token=self.bot_token)
        data = json.dumps({
            "chat_id": self.chat_id,
            "text": message,
            "parse_mode": parse_mode,
            "disable_web_page_preview": False
        }).encode()

        try:
            req = urllib.request.Request(url, data=data, method='POST')
            req.add_header('Content-Type', 'application/json')

            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read().decode())
                return result.get("ok", False)

        except Exception as e:
            print(f"  Telegram error: {e}")
            return False

    def format_live_feed(self, items: List[Dict]) -> str:
        """Format live feed items for Telegram."""
        if not items:
            return ""

        lines = ["🔔 <b>New Claude/AI Updates</b>\n"]

        for item in items[:10]:  # Limit to 10 items
            source = item.get("source", "unknown")

            if source == "youtube":
                channel = item.get("channel", "Unknown")
                title = item.get("title", "")[:100]
                link = item.get("link", "")
                lines.append(f"📺 <b>{channel}</b>")
                lines.append(f"   {title}")
                lines.append(f"   {link}\n")

            elif source == "twitter":
                account = item.get("account", "unknown")
                text = item.get("text", "")[:150]
                link = item.get("link", "")
                lines.append(f"🐦 <b>@{account}</b>")
                lines.append(f"   {text}...")
                lines.append(f"   {link}\n")

        return "\n".join(lines)

    def format_alert(self, severity: str, alert_type: str, message: str) -> str:
        """Format an alert for Telegram."""
        icons = {
            "critical": "🚨",
            "warning": "⚠️",
            "info": "ℹ️"
        }
        icon = icons.get(severity, "📢")

        return f"{icon} <b>Nuke Sentinel Alert</b>\n\n<b>Type:</b> {alert_type}\n<b>Severity:</b> {severity}\n\n{message}"


class SupabaseNotifier:
    """Store alerts in Supabase."""

    def __init__(self, url: str = None, key: str = None):
        self.url = url or os.getenv("VITE_SUPABASE_URL")
        self.key = key or os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    def is_configured(self) -> bool:
        return bool(self.url and self.key)

    def insert_alert(self, severity: str, alert_type: str, message: str, data: Dict = None) -> bool:
        """Insert alert into sentinel_alerts table."""
        if not self.is_configured():
            return False

        url = f"{self.url}/rest/v1/sentinel_alerts"
        payload = {
            "severity": severity,
            "type": alert_type,
            "message": message,
            "data": data or {}
        }

        try:
            req = urllib.request.Request(url, data=json.dumps(payload).encode(), method='POST')
            req.add_header('Authorization', f'Bearer {self.key}')
            req.add_header('Content-Type', 'application/json')
            req.add_header('apikey', self.key)
            req.add_header('Prefer', 'return=minimal')

            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status in (200, 201)

        except Exception as e:
            print(f"  Supabase error: {e}")
            return False


class NotificationManager:
    """Unified notification manager."""

    def __init__(self):
        self.telegram = TelegramNotifier()
        self.supabase = SupabaseNotifier()

    def notify_live_feed(self, items: List[Dict]):
        """Send notifications for new live feed items."""
        if not items:
            return

        # Telegram
        if self.telegram.is_configured():
            message = self.telegram.format_live_feed(items)
            if message:
                success = self.telegram.send(message)
                print(f"  Telegram notification: {'sent' if success else 'failed'}")

    def notify_alert(self, severity: str, alert_type: str, message: str, data: Dict = None):
        """Send alert notifications."""
        # Telegram (for critical/warning)
        if severity in ("critical", "warning") and self.telegram.is_configured():
            tg_message = self.telegram.format_alert(severity, alert_type, message)
            self.telegram.send(tg_message)

        # Supabase (all alerts)
        if self.supabase.is_configured():
            self.supabase.insert_alert(severity, alert_type, message, data)


def setup_telegram():
    """Interactive setup for Telegram notifications."""
    print("=== Telegram Setup ===\n")
    print("1. Message @BotFather on Telegram")
    print("2. Send /newbot and follow instructions")
    print("3. Copy the bot token\n")

    token = input("Enter bot token: ").strip()

    print("\n4. Start a chat with your new bot")
    print("5. Send any message to it")
    print("6. Run this to get your chat ID:")
    print(f"   curl https://api.telegram.org/bot{token}/getUpdates | jq\n")

    chat_id = input("Enter chat ID: ").strip()

    # Test
    notifier = TelegramNotifier(token, chat_id)
    success = notifier.send("🤖 Nuke Sentinel connected!")

    if success:
        print("\n✓ Test message sent!")
        print(f"\nAdd to your .env:")
        print(f"TELEGRAM_BOT_TOKEN={token}")
        print(f"TELEGRAM_CHAT_ID={chat_id}")
    else:
        print("\n✗ Failed to send test message")


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "--setup":
        setup_telegram()
    else:
        # Test notifications
        manager = NotificationManager()
        print(f"Telegram configured: {manager.telegram.is_configured()}")
        print(f"Supabase configured: {manager.supabase.is_configured()}")

        # Test with sample data
        if manager.telegram.is_configured():
            test_items = [
                {
                    "source": "youtube",
                    "channel": "Fireship",
                    "title": "Anthropic just bought your favorite JS runtime",
                    "link": "https://youtube.com/watch?v=test"
                }
            ]
            manager.notify_live_feed(test_items)
