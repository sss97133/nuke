#!/usr/bin/env python3
"""
Live Feed Monitor - Near real-time YouTube and X/Twitter monitoring
"""

import os
import json
import hashlib
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import datetime, timedelta
from typing import List, Dict, Optional

AGENT_DIR = Path(__file__).parent
CACHE_DIR = AGENT_DIR / ".cache"
SEEN_FILE = CACHE_DIR / "seen_items.json"

# Ensure cache dir exists
CACHE_DIR.mkdir(exist_ok=True)


def load_seen() -> set:
    """Load already-seen item IDs."""
    if SEEN_FILE.exists():
        with open(SEEN_FILE) as f:
            data = json.load(f)
            return set(data.get("ids", []))
    return set()


def save_seen(seen: set):
    """Save seen item IDs."""
    # Keep only last 10k items
    ids = list(seen)[-10000:]
    with open(SEEN_FILE, 'w') as f:
        json.dump({"ids": ids, "updated": datetime.now().isoformat()}, f)


def item_id(source: str, unique: str) -> str:
    """Generate unique ID for an item."""
    return hashlib.md5(f"{source}:{unique}".encode()).hexdigest()[:16]


class YouTubeMonitor:
    """Monitor YouTube channels via RSS feeds."""

    RSS_URL = "https://www.youtube.com/feeds/videos.xml?channel_id={}"

    def __init__(self, channels: List[Dict], keywords: List[str]):
        self.channels = channels
        self.keywords = [k.lower() for k in keywords]

    def fetch_channel(self, channel_id: str) -> List[Dict]:
        """Fetch recent videos from a channel."""
        url = self.RSS_URL.format(channel_id)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "NukeSentinel/1.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                xml_data = resp.read().decode()

            # Parse Atom feed
            root = ET.fromstring(xml_data)
            ns = {"atom": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}

            videos = []
            for entry in root.findall("atom:entry", ns):
                title = entry.find("atom:title", ns).text
                video_id = entry.find("yt:videoId", ns).text
                published = entry.find("atom:published", ns).text
                link = f"https://youtube.com/watch?v={video_id}"

                videos.append({
                    "title": title,
                    "video_id": video_id,
                    "published": published,
                    "link": link
                })

            return videos
        except Exception as e:
            print(f"  Error fetching {channel_id}: {e}")
            return []

    def matches_keywords(self, text: str) -> bool:
        """Check if text contains any keywords."""
        text_lower = text.lower()
        return any(kw in text_lower for kw in self.keywords)

    def check_all(self, seen: set) -> List[Dict]:
        """Check all channels for new relevant videos."""
        new_items = []

        for channel in self.channels:
            print(f"  Checking YouTube: {channel['name']}")
            videos = self.fetch_channel(channel["id"])

            for video in videos:
                vid = item_id("youtube", video["video_id"])

                if vid in seen:
                    continue

                # Check if relevant (matches keywords OR from priority channel)
                if self.matches_keywords(video["title"]):
                    video["source"] = "youtube"
                    video["channel"] = channel["name"]
                    video["relevance"] = "keyword_match"
                    new_items.append(video)
                    seen.add(vid)

        return new_items


class TwitterMonitor:
    """Monitor Twitter/X via web search (works without X API)."""

    def __init__(self, accounts: List[str], keywords: List[str]):
        self.accounts = [a.lstrip("@") for a in accounts]
        self.keywords = [k.lower() for k in keywords]
        self.results_cache = []

    def set_web_results(self, results: List[Dict]):
        """
        Set results from external web search.
        Called by runner which has WebSearch access.
        """
        self.results_cache = results

    def parse_web_results(self) -> List[Dict]:
        """Parse web search results into tweet format."""
        tweets = []

        for r in self.results_cache:
            url = r.get("url", "")
            title = r.get("title", "")

            # Only process X posts
            if "x.com" not in url:
                continue

            # Extract account from URL
            if "/status/" in url:
                parts = url.split("x.com/")[1].split("/") if "x.com/" in url else []
                account = parts[0] if parts else "unknown"
                post_id = url.split("/status/")[-1].split("?")[0]
            else:
                account = url.split("x.com/")[1].split("/")[0] if "x.com/" in url else "unknown"
                post_id = ""

            # Clean up title (remove " / X" suffix)
            text = title.replace(" / X", "").replace(" on X:", ":").strip()

            if text and post_id:
                tweets.append({
                    "text": text,
                    "tweet_id": post_id,
                    "link": url,
                    "account": account,
                    "source": "twitter"
                })

        return tweets

    def matches_keywords(self, text: str) -> bool:
        """Check if text contains any keywords."""
        text_lower = text.lower()
        return any(kw in text_lower for kw in self.keywords)

    def check_all(self, seen: set) -> List[Dict]:
        """Check parsed results for new relevant tweets."""
        new_items = []
        tweets = self.parse_web_results()

        for tweet in tweets:
            tid = item_id("twitter", tweet.get("tweet_id", tweet["text"][:50]))

            if tid in seen:
                continue

            # Priority accounts - take everything, others need keyword match
            priority_accounts = ["anthropicai", "alexalbert__", "swyx", "karpathy"]
            account_lower = tweet.get("account", "").lower()
            is_priority = account_lower in priority_accounts

            if is_priority or self.matches_keywords(tweet["text"]):
                tweet["relevance"] = "priority_account" if is_priority else "keyword_match"
                new_items.append(tweet)
                seen.add(tid)

        return new_items


class WebSearchMonitor:
    """Use web search for real-time keyword monitoring."""

    def __init__(self, keywords: List[str]):
        self.keywords = keywords

    def search_recent(self, query: str, hours: int = 1) -> List[Dict]:
        """Search for recent mentions.
        Note: Requires web search API - placeholder for now.
        """
        # This would use the WebSearch tool in Claude Code
        # For standalone Python, would need an API like SerpAPI, Brave, etc.
        return []


def run_live_feed(params: Dict) -> Dict:
    """Main entry point for live feed monitoring."""
    print("=== Live Feed Monitor ===")

    seen = load_seen()
    all_new = []

    # YouTube
    yt_params = params.get("youtube", {})
    if yt_params.get("channels"):
        yt = YouTubeMonitor(yt_params["channels"], yt_params.get("keywords", []))
        yt_new = yt.check_all(seen)
        all_new.extend(yt_new)
        print(f"  YouTube: {len(yt_new)} new items")

    # Twitter/X
    tw_params = params.get("twitter", {})
    if tw_params.get("accounts"):
        tw = TwitterMonitor(tw_params["accounts"], tw_params.get("keywords", []))
        tw_new = tw.check_all(seen)
        all_new.extend(tw_new)
        print(f"  Twitter: {len(tw_new)} new items")

    # Save seen items
    save_seen(seen)

    # Output new items
    if all_new:
        print(f"\n=== {len(all_new)} NEW ITEMS ===")
        for item in all_new:
            source = item.get("source", "unknown")
            if source == "youtube":
                print(f"  [YT] {item['channel']}: {item['title']}")
                print(f"       {item['link']}")
            elif source == "twitter":
                print(f"  [X] @{item['account']}: {item['text'][:100]}...")
                print(f"      {item['link']}")

        # Save to discoveries
        disc_file = AGENT_DIR / "discoveries" / f"live-{datetime.now().strftime('%Y%m%d-%H%M')}.json"
        with open(disc_file, 'w') as f:
            json.dump({
                "timestamp": datetime.now().isoformat(),
                "count": len(all_new),
                "items": all_new
            }, f, indent=2)
        print(f"\nSaved to: {disc_file.name}")
    else:
        print("\nNo new items found")

    return {
        "status": "completed",
        "new_count": len(all_new),
        "items": all_new
    }


if __name__ == "__main__":
    # Test run
    test_params = {
        "youtube": {
            "channels": [
                {"name": "Anthropic", "id": "UCksTVgiZESlfRcXhSNvVWkA"},
                {"name": "Fireship", "id": "UCsBjURrPoezykLs9EqgamOA"}
            ],
            "keywords": ["claude", "anthropic", "ai agent"]
        },
        "twitter": {
            "accounts": ["@AnthropicAI", "@alexalbert__", "@swyx"],
            "keywords": ["claude code", "claude", "mcp"]
        }
    }

    result = run_live_feed(test_params)
    print(f"\nResult: {result['new_count']} new items")
