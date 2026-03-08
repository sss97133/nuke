#!/usr/bin/env python3
"""
YouTube transcript fetcher and analyzer for Nuke Sentinel.
Pulls captions and uses local LLM to extract actionable insights.
"""

import json
import subprocess
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional

try:
    from youtube_transcript_api import YouTubeTranscriptApi
    HAS_YT_API = True
except ImportError:
    HAS_YT_API = False
    print("Install: pip install youtube-transcript-api")

AGENT_DIR = Path(__file__).parent
CACHE_DIR = AGENT_DIR / ".cache" / "transcripts"
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def get_transcript(video_id: str) -> Optional[str]:
    """Fetch transcript for a YouTube video."""
    if not HAS_YT_API:
        return None

    # Check cache first
    cache_file = CACHE_DIR / f"{video_id}.txt"
    if cache_file.exists():
        return cache_file.read_text()

    try:
        transcript = YouTubeTranscriptApi().fetch(video_id)
        full_text = " ".join([t.text for t in transcript])

        # Cache it
        cache_file.write_text(full_text)
        return full_text

    except Exception as e:
        print(f"  No transcript for {video_id}: {e}")
        return None


def analyze_transcript(title: str, transcript: str, model: str = "llama3.2:3b") -> Dict:
    """Analyze a transcript using local Ollama."""
    # Truncate to reasonable length
    text = transcript[:4000]

    prompt = f"""Analyze this YouTube video transcript about AI/Claude.

Title: {title}

Extract:
1. MAIN_NEWS: What's the key announcement? (1 sentence)
2. ACTION: What can a developer building with Claude do with this? (1-2 sentences)
3. RELEVANCE: Score 1-10 for someone using Claude Code and MCPs for data pipelines
4. TAGS: 3-5 keywords

Be concise. JSON output only.

Transcript excerpt:
{text}"""

    try:
        result = subprocess.run(
            ["ollama", "run", model, prompt],
            capture_output=True,
            text=True,
            timeout=60
        )
        output = result.stdout.strip()

        # Try to parse JSON from output
        # Sometimes Ollama wraps it in markdown
        if "```json" in output:
            output = output.split("```json")[1].split("```")[0]
        elif "```" in output:
            output = output.split("```")[1].split("```")[0]

        try:
            return json.loads(output)
        except:
            # Return raw analysis if not JSON
            return {"raw_analysis": output}

    except Exception as e:
        return {"error": str(e)}


def process_video(video_id: str, title: str) -> Dict:
    """Full pipeline: fetch transcript and analyze."""
    result = {
        "video_id": video_id,
        "title": title,
        "url": f"https://youtube.com/watch?v={video_id}",
        "processed_at": datetime.now().isoformat()
    }

    transcript = get_transcript(video_id)
    if transcript:
        result["has_transcript"] = True
        result["transcript_length"] = len(transcript)
        result["analysis"] = analyze_transcript(title, transcript)
    else:
        result["has_transcript"] = False
        result["analysis"] = None

    return result


def process_batch(videos: List[Dict]) -> List[Dict]:
    """Process multiple videos."""
    results = []

    for v in videos:
        video_id = v.get("video_id") or v.get("id")
        title = v.get("title", "Unknown")

        if not video_id:
            # Extract from URL
            url = v.get("link", v.get("url", ""))
            if "watch?v=" in url:
                video_id = url.split("watch?v=")[1].split("&")[0]

        if video_id:
            print(f"Processing: {title[:50]}...")
            result = process_video(video_id, title)
            results.append(result)

    return results


def quick_digest(videos: List[Dict]) -> str:
    """Create a quick digest of multiple videos."""
    results = process_batch(videos)

    digest = "# Video Digest\n\n"
    for r in results:
        digest += f"## {r['title']}\n"
        digest += f"- URL: {r['url']}\n"

        if r.get("analysis"):
            a = r["analysis"]
            if isinstance(a, dict):
                if "MAIN_NEWS" in a:
                    digest += f"- **News**: {a['MAIN_NEWS']}\n"
                if "ACTION" in a:
                    digest += f"- **Action**: {a['ACTION']}\n"
                if "RELEVANCE" in a:
                    digest += f"- **Relevance**: {a['RELEVANCE']}/10\n"
                if "raw_analysis" in a:
                    digest += f"- {a['raw_analysis'][:300]}...\n"
        digest += "\n"

    return digest


if __name__ == "__main__":
    # Test with recent findings
    test_videos = [
        {"video_id": "5JMiNsV7P3Y", "title": "Anthropic bought JS runtime"},
        {"video_id": "PLyCki2K0Lg", "title": "Why we built MCP"},
    ]

    print("Testing transcript analysis...\n")
    digest = quick_digest(test_videos)
    print(digest)
