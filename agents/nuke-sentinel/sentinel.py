#!/usr/bin/env python3
"""
Nuke Sentinel - Unified Runner
Monitors YouTube + X, pulls transcripts, analyzes, digests.
Run continuously or on-demand.
"""

import os
import json
import time
import subprocess
from pathlib import Path
from datetime import datetime, timedelta
from typing import List, Dict, Optional

# Local imports
from feeds import YouTubeMonitor, load_seen, save_seen, item_id
from transcripts import get_transcript, analyze_transcript

AGENT_DIR = Path(__file__).parent
CONFIG_FILE = AGENT_DIR / "config.json"
DIGEST_DIR = AGENT_DIR / "digests"
DIGEST_DIR.mkdir(exist_ok=True)

# Telegram config
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")


class NukeSentinel:
    def __init__(self):
        self.config = self._load_config()
        self.seen = load_seen()
        self.last_digest = None

    def _load_config(self) -> dict:
        if CONFIG_FILE.exists():
            with open(CONFIG_FILE) as f:
                return json.load(f)
        return {}

    def log(self, msg: str, level: str = "INFO"):
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"[{ts}] [{level}] {msg}")

    # =========== YOUTUBE ===========

    def scan_youtube(self) -> List[Dict]:
        """Scan YouTube channels for new videos."""
        channels = [
            {"name": "Anthropic", "id": "UCrDwWp7EBBv4NwvScIpBDOA"},
            {"name": "Fireship", "id": "UCsBjURrPoezykLs9EqgamOA"},
            {"name": "AI Explained", "id": "UCNJ1Ymd5yFuUPtn21xtRbbw"},
            {"name": "Matthew Berman", "id": "UCML_5grfABPGvbWM1SWqzCQ"},
            {"name": "All About AI", "id": "UCUxw2FfmIHPtzr_mFw_vccw"},
        ]
        keywords = ["claude", "anthropic", "mcp", "opus", "sonnet", "ai agent", "grok"]

        yt = YouTubeMonitor(channels, keywords)
        new_items = yt.check_all(self.seen)
        save_seen(self.seen)

        return new_items

    # =========== TRANSCRIPTS ===========

    def enrich_with_transcripts(self, videos: List[Dict]) -> List[Dict]:
        """Pull transcripts and analyze videos."""
        enriched = []

        for v in videos:
            video_id = v.get("video_id")
            if not video_id and v.get("link"):
                # Extract from URL
                url = v["link"]
                if "watch?v=" in url:
                    video_id = url.split("watch?v=")[1].split("&")[0]

            if not video_id:
                enriched.append(v)
                continue

            self.log(f"  Fetching transcript: {v.get('title', video_id)[:40]}...")
            transcript = get_transcript(video_id)

            if transcript:
                v["has_transcript"] = True
                v["transcript_preview"] = transcript[:500]

                # Analyze
                self.log(f"  Analyzing...")
                analysis = analyze_transcript(v.get("title", ""), transcript)
                v["analysis"] = analysis
            else:
                v["has_transcript"] = False

            enriched.append(v)

        return enriched

    # =========== DIGEST ===========

    def create_digest(self, items: List[Dict]) -> str:
        """Create a human-readable digest."""
        if not items:
            return "No new items found."

        lines = [
            f"🔔 **Sentinel Digest** - {datetime.now().strftime('%Y-%m-%d %H:%M')}",
            f"Found {len(items)} new items\n"
        ]

        for i, item in enumerate(items, 1):
            source = item.get("source", "unknown")

            if source == "youtube":
                channel = item.get("channel", "?")
                title = item.get("title", "?")[:60]
                url = item.get("link", "")

                lines.append(f"**{i}. [{channel}] {title}**")
                lines.append(f"   {url}")

                # Add analysis if available
                if item.get("analysis"):
                    a = item["analysis"]
                    if isinstance(a, dict):
                        if a.get("MAIN_NEWS"):
                            lines.append(f"   → {a['MAIN_NEWS']}")
                        if a.get("ACTION"):
                            lines.append(f"   💡 {a['ACTION']}")
                        if a.get("RELEVANCE"):
                            lines.append(f"   📊 Relevance: {a['RELEVANCE']}/10")
                lines.append("")

            elif source == "twitter":
                account = item.get("account", "?")
                text = item.get("text", "")[:100]
                url = item.get("link", "")

                lines.append(f"**{i}. @{account}**")
                lines.append(f"   {text}...")
                lines.append(f"   {url}")
                lines.append("")

        return "\n".join(lines)

    # =========== NOTIFY ===========

    def send_telegram(self, message: str) -> bool:
        """Send digest to Telegram."""
        if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
            return False

        import urllib.request
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"

        # Telegram has 4096 char limit
        if len(message) > 4000:
            message = message[:4000] + "\n...(truncated)"

        data = json.dumps({
            "chat_id": TELEGRAM_CHAT_ID,
            "text": message,
            "parse_mode": "Markdown",
            "disable_web_page_preview": True
        }).encode()

        try:
            req = urllib.request.Request(url, data=data, method='POST')
            req.add_header('Content-Type', 'application/json')
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status == 200
        except Exception as e:
            self.log(f"Telegram error: {e}", "ERROR")
            return False

    # =========== MAIN CYCLE ===========

    def run_cycle(self) -> Dict:
        """Run one full monitoring cycle."""
        self.log("=" * 50)
        self.log("Starting cycle")

        results = {
            "timestamp": datetime.now().isoformat(),
            "youtube": [],
            "twitter": [],
            "total_new": 0
        }

        # 1. Scan YouTube
        self.log("Scanning YouTube...")
        yt_items = self.scan_youtube()
        self.log(f"  Found {len(yt_items)} new YouTube items")

        # 2. Enrich with transcripts (only for new items)
        if yt_items:
            self.log("Enriching with transcripts...")
            yt_items = self.enrich_with_transcripts(yt_items)

        results["youtube"] = yt_items
        results["total_new"] = len(yt_items)

        # 3. Create digest
        if results["total_new"] > 0:
            digest = self.create_digest(yt_items)
            print("\n" + digest)

            # Save digest
            digest_file = DIGEST_DIR / f"{datetime.now().strftime('%Y%m%d-%H%M')}.md"
            digest_file.write_text(digest)
            self.log(f"Saved digest: {digest_file.name}")

            # 4. Send to Telegram if configured
            if TELEGRAM_BOT_TOKEN:
                self.log("Sending to Telegram...")
                self.send_telegram(digest)

            self.last_digest = digest
        else:
            self.log("No new items")

        self.log("Cycle complete")
        return results

    def run_forever(self, interval_mins: int = 15):
        """Run continuously."""
        self.log(f"Starting sentinel (checking every {interval_mins} min)")
        self.log("Press Ctrl+C to stop\n")

        while True:
            try:
                self.run_cycle()
            except Exception as e:
                self.log(f"Cycle error: {e}", "ERROR")

            # Sleep
            self.log(f"Sleeping {interval_mins} minutes...")
            time.sleep(interval_mins * 60)


def main():
    import sys

    sentinel = NukeSentinel()

    if len(sys.argv) > 1:
        arg = sys.argv[1]
        if arg == "--once":
            sentinel.run_cycle()
        elif arg.startswith("--interval="):
            mins = int(arg.split("=")[1])
            sentinel.run_forever(interval_mins=mins)
        elif arg == "--help":
            print("Usage:")
            print("  python sentinel.py           # Run forever (15 min interval)")
            print("  python sentinel.py --once    # Run once and exit")
            print("  python sentinel.py --interval=5  # Custom interval (minutes)")
        else:
            print(f"Unknown arg: {arg}")
    else:
        sentinel.run_forever()


if __name__ == "__main__":
    main()
