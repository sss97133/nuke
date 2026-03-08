#!/usr/bin/env python3
"""
X/Twitter search using web search as a proxy.
Works without X API credentials.
"""

import json
import subprocess
from datetime import datetime
from pathlib import Path

AGENT_DIR = Path(__file__).parent
CACHE_DIR = AGENT_DIR / ".cache"
CACHE_DIR.mkdir(exist_ok=True)

# Accounts and keywords to monitor
PRIORITY_ACCOUNTS = [
    "AnthropicAI",
    "alexalbert__",
    "swyx",
    "karpathy",
    "DrJimFan",
    "simonw"
]

SEARCH_TERMS = [
    "claude code",
    "anthropic mcp",
    "claude api",
    "opus 4",
    "claude skills"
]


def search_x_via_web(query: str) -> list:
    """
    Search X content via web search.
    This is called from the sentinel runner which has WebSearch access.
    Returns structured results.
    """
    # This function is a placeholder - actual search happens via Claude's WebSearch tool
    # The runner will call WebSearch and pass results here for processing
    pass


def parse_x_search_results(results: list) -> list:
    """Parse web search results that contain X posts."""
    posts = []

    for r in results:
        url = r.get("url", "")
        title = r.get("title", "")

        # Check if it's an X post
        if "x.com" in url and "/status/" in url:
            # Extract account from URL
            parts = url.split("x.com/")[1].split("/")
            account = parts[0] if parts else "unknown"

            # Extract post ID
            post_id = url.split("/status/")[-1].split("?")[0] if "/status/" in url else ""

            posts.append({
                "account": account,
                "text": title,
                "url": url,
                "post_id": post_id,
                "source": "web_search"
            })

    return posts


def generate_search_queries() -> list:
    """Generate search queries for X monitoring."""
    queries = []

    # Account-specific searches
    for account in PRIORITY_ACCOUNTS[:3]:  # Limit to avoid rate limits
        queries.append(f'site:x.com from:{account} "claude" OR "anthropic" 2026')

    # Keyword searches
    for term in SEARCH_TERMS[:3]:
        queries.append(f'site:x.com "{term}" 2026')

    return queries


def dedupe_posts(posts: list, seen_file: Path = None) -> list:
    """Remove duplicate posts based on post_id."""
    if seen_file is None:
        seen_file = CACHE_DIR / "seen_x_posts.json"

    # Load seen
    seen = set()
    if seen_file.exists():
        with open(seen_file) as f:
            seen = set(json.load(f).get("ids", []))

    new_posts = []
    for p in posts:
        pid = p.get("post_id") or p.get("url")
        if pid and pid not in seen:
            new_posts.append(p)
            seen.add(pid)

    # Save seen
    with open(seen_file, 'w') as f:
        json.dump({"ids": list(seen)[-5000], "updated": datetime.now().isoformat()}, f)

    return new_posts


if __name__ == "__main__":
    queries = generate_search_queries()
    print("Generated X search queries:")
    for q in queries:
        print(f"  - {q}")
