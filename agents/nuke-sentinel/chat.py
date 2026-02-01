#!/usr/bin/env python3
"""
Nuke Sentinel Chat Mode
Interactive conversational monitoring - keeps the flow going.
"""

import os
import json
import time
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List, Dict

# Use local Ollama or Grok for chat
XAI_API_KEY = os.getenv("XAI_API_KEY")
USE_GROK = bool(XAI_API_KEY)

AGENT_DIR = Path(__file__).parent
STATE_FILE = AGENT_DIR / ".chat_state.json"


class SentinelChat:
    """Interactive chat interface for the sentinel."""

    def __init__(self):
        self.state = self._load_state()
        self.last_check = datetime.now()
        self.pending_alerts = []
        self.monitor_thread = None
        self.running = False

    def _load_state(self) -> dict:
        if STATE_FILE.exists():
            with open(STATE_FILE) as f:
                return json.load(f)
        return {
            "last_findings": [],
            "conversation": [],
            "preferences": {
                "verbosity": "medium",  # low, medium, high
                "notify_on": ["priority_account", "critical"]
            }
        }

    def _save_state(self):
        with open(STATE_FILE, 'w') as f:
            json.dump(self.state, f, indent=2, default=str)

    def _call_llm(self, prompt: str, system: str = None) -> str:
        """Call Grok or local Ollama for chat responses."""
        import urllib.request

        if USE_GROK:
            url = "https://api.x.ai/v1/chat/completions"
            messages = []
            if system:
                messages.append({"role": "system", "content": system})
            messages.append({"role": "user", "content": prompt})

            data = json.dumps({
                "model": "grok-3-mini",
                "messages": messages,
                "max_tokens": 500
            }).encode()

            req = urllib.request.Request(url, data=data, method='POST')
            req.add_header("Authorization", f"Bearer {XAI_API_KEY}")
            req.add_header("Content-Type", "application/json")

            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    result = json.loads(resp.read().decode())
                    return result["choices"][0]["message"]["content"]
            except Exception as e:
                return f"[LLM error: {e}]"
        else:
            # Use local Ollama
            import subprocess
            try:
                result = subprocess.run(
                    ["ollama", "run", "llama3.2:3b", prompt],
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                return result.stdout.strip()
            except Exception as e:
                return f"[Ollama error: {e}]"

    def greet(self) -> str:
        """Initial greeting with status."""
        # Check recent findings
        findings = self._get_recent_findings()

        if findings:
            intro = f"Hey! I've been watching. Found {len(findings)} things since we last talked:\n\n"
            for f in findings[:3]:
                intro += f"• {f['summary']}\n"
            intro += "\nWant me to dig into any of these?"
        else:
            intro = "Hey! All quiet right now. I'm watching:\n"
            intro += "• YouTube: 8 AI channels\n"
            intro += "• X: @AnthropicAI, @alexalbert__, etc.\n"
            intro += "• Your Nuke pipeline health\n\n"
            intro += "Ask me anything or just say 'what's new?'"

        return intro

    def _get_recent_findings(self) -> List[Dict]:
        """Get findings from the last few hours."""
        discoveries_dir = AGENT_DIR / "discoveries"
        findings = []

        if discoveries_dir.exists():
            for f in sorted(discoveries_dir.glob("*.json"), reverse=True)[:5]:
                try:
                    with open(f) as file:
                        data = json.load(file)
                        items = data.get("items", [])
                        for item in items[:3]:
                            findings.append({
                                "summary": self._summarize_item(item),
                                "item": item,
                                "file": str(f)
                            })
                except:
                    pass

        return findings

    def _summarize_item(self, item: dict) -> str:
        """Create a short summary of an item."""
        source = item.get("source", "unknown")
        if source == "youtube":
            return f"[YT] {item.get('channel', '?')}: {item.get('title', '')[:60]}"
        elif source == "twitter":
            return f"[X] @{item.get('account', '?')}: {item.get('text', '')[:60]}..."
        else:
            return str(item)[:80]

    def respond(self, user_input: str) -> str:
        """Generate a response to user input."""
        lower = user_input.lower().strip()

        # Quick commands
        if lower in ("hi", "hello", "hey"):
            return self.greet()

        if lower in ("what's new", "whats new", "new", "updates", "?"):
            return self._whats_new()

        if lower in ("status", "health", "pipeline"):
            return self._pipeline_status()

        if lower.startswith("search "):
            query = user_input[7:].strip()
            return self._search(query)

        if lower in ("help", "commands"):
            return self._help()

        # Otherwise, have a conversation
        return self._chat(user_input)

    def _whats_new(self) -> str:
        """Report what's new."""
        findings = self._get_recent_findings()

        if not findings:
            return "Nothing new in the last check. Want me to run a fresh scan? (say 'scan')"

        response = f"Found {len(findings)} items:\n\n"
        for i, f in enumerate(findings[:5], 1):
            response += f"{i}. {f['summary']}\n"

        response += "\nSay a number to get details, or 'more' for older stuff."
        return response

    def _pipeline_status(self) -> str:
        """Check Nuke pipeline health."""
        # Would call the coordinator here
        return (
            "📊 Pipeline Status:\n"
            "• Extraction queue: checking...\n"
            "• Error rate: checking...\n\n"
            "(Run 'scan pipeline' for full check)"
        )

    def _search(self, query: str) -> str:
        """Search for something specific."""
        return f"Searching for: {query}\n\n(This will use web search + Grok analysis)"

    def _chat(self, user_input: str) -> str:
        """Have a conversation about the findings."""
        system = """You are Nuke Sentinel, a friendly AI assistant monitoring Claude/AI tools and a vehicle data platform.
Keep responses short and conversational. You're like a helpful colleague who's always watching for interesting AI developments.
If asked about something you found, give details. If asked opinions, be direct but brief."""

        # Add context from recent findings
        findings = self._get_recent_findings()
        context = ""
        if findings:
            context = "\n\nRecent findings:\n" + "\n".join([f["summary"] for f in findings[:3]])

        prompt = f"{user_input}{context}"
        return self._call_llm(prompt, system)

    def _help(self) -> str:
        return """Commands:
• what's new - latest findings
• status - pipeline health
• search <query> - search for something
• scan - run a fresh check
• hi/hello - greeting with status

Or just chat naturally!"""

    def start_background_monitor(self, interval_secs: int = 300):
        """Start background monitoring thread."""
        self.running = True

        def monitor_loop():
            while self.running:
                # Run checks
                # ... (import and run from feeds.py)
                time.sleep(interval_secs)

        self.monitor_thread = threading.Thread(target=monitor_loop, daemon=True)
        self.monitor_thread.start()

    def stop(self):
        self.running = False
        self._save_state()


def main():
    """Interactive chat loop."""
    print("=" * 50)
    print("NUKE SENTINEL - Chat Mode")
    print("=" * 50)

    chat = SentinelChat()
    print(chat.greet())
    print()

    while True:
        try:
            user_input = input("you> ").strip()
            if not user_input:
                continue
            if user_input.lower() in ("quit", "exit", "bye"):
                print("Later! I'll keep watching.")
                break

            response = chat.respond(user_input)
            print(f"\nsentinel> {response}\n")

        except KeyboardInterrupt:
            print("\nLater!")
            break
        except EOFError:
            break

    chat.stop()


if __name__ == "__main__":
    main()
