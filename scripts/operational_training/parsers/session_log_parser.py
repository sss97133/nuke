"""Parse Claude Code session logs into structured exchanges."""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class SessionExchange:
    session_id: str
    user_intent: str
    tool_sequence: list[str] = field(default_factory=list)
    tool_details: list[dict] = field(default_factory=list)
    final_response: str = ""
    category_hint: str = "general"


def classify_exchange(exchange: SessionExchange) -> str:
    """Classify an exchange by dominant patterns."""
    tools_str = " ".join(exchange.tool_sequence).lower()
    text = (exchange.user_intent + " " + exchange.final_response).lower()

    # Classification by tool usage and keywords
    if any(k in text for k in ["stuck", "stale", "lock", "error", "crash", "broken", "fix"]):
        return "incident_recovery"
    if "mcp__supabase" in tools_str or "execute_sql" in tools_str:
        if any(k in text for k in ["count", "select", "query", "check", "status"]):
            return "database_investigation"
        return "database_operation"
    if any(k in text for k in ["extract", "scrape", "import", "crawl", "fetch"]):
        return "extraction"
    if any(k in text for k in ["deploy", "supabase functions"]):
        return "deployment"
    if any(k in text for k in ["delete", "purge", "clean", "remove", "drop"]):
        return "data_cleanup"
    if any(k in text for k in ["status", "health", "brief", "queue", "dashboard"]):
        return "system_health"
    if "edit" in tools_str or "write" in tools_str:
        return "code_modification"
    if "read" in tools_str or "glob" in tools_str or "grep" in tools_str:
        return "code_investigation"

    return "general"


def parse_session_file(path: Path) -> list[SessionExchange]:
    """Parse a single session JSONL file into exchanges."""
    exchanges = []

    try:
        with open(path) as f:
            events = [json.loads(line) for line in f if line.strip()]
    except (json.JSONDecodeError, UnicodeDecodeError):
        return []

    session_id = path.stem

    # Split events into exchanges at each real user message
    current_exchange = None

    for event in events:
        etype = event.get("type", "")

        if etype == "user":
            # Check if this is a tool result (not a real user message)
            msg = event.get("message", {})
            if isinstance(msg, dict):
                content = msg.get("content", [])
                if isinstance(content, list):
                    # Tool results have tool_use_id
                    has_tool_result = any(
                        isinstance(c, dict) and c.get("type") == "tool_result"
                        for c in content
                    )
                    if has_tool_result:
                        continue

                    # Extract user text
                    user_text = ""
                    for c in content:
                        if isinstance(c, dict) and c.get("type") == "text":
                            user_text += c.get("text", "")

                    if user_text.strip():
                        # Save previous exchange
                        if current_exchange and current_exchange.user_intent:
                            current_exchange.category_hint = classify_exchange(current_exchange)
                            exchanges.append(current_exchange)

                        current_exchange = SessionExchange(
                            session_id=session_id,
                            user_intent=user_text.strip()[:1000],
                        )

        elif etype == "assistant" and current_exchange:
            msg = event.get("message", {})
            if isinstance(msg, dict):
                content = msg.get("content", [])
                if isinstance(content, list):
                    for c in content:
                        if not isinstance(c, dict):
                            continue
                        if c.get("type") == "tool_use":
                            tool_name = c.get("name", "")
                            current_exchange.tool_sequence.append(tool_name)
                            # Summarize tool input
                            tool_input = c.get("input", {})
                            summary = {}
                            if isinstance(tool_input, dict):
                                if "command" in tool_input:
                                    summary["command"] = str(tool_input["command"])[:200]
                                if "file_path" in tool_input:
                                    summary["file"] = tool_input["file_path"]
                                if "pattern" in tool_input:
                                    summary["pattern"] = tool_input["pattern"]
                                if "query" in tool_input:
                                    summary["query"] = str(tool_input["query"])[:200]
                            current_exchange.tool_details.append({
                                "name": tool_name,
                                "summary": summary,
                            })
                        elif c.get("type") == "text":
                            text = c.get("text", "").strip()
                            if text and len(text) > len(current_exchange.final_response):
                                current_exchange.final_response = text[:2000]

    # Save last exchange
    if current_exchange and current_exchange.user_intent:
        current_exchange.category_hint = classify_exchange(current_exchange)
        exchanges.append(current_exchange)

    return exchanges


def parse_all_sessions(sessions_dir: Path, max_files: int = 200) -> list[SessionExchange]:
    """Parse all session JSONL files in the directory."""
    all_exchanges = []
    jsonl_files = sorted(sessions_dir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)

    for path in jsonl_files[:max_files]:
        if path.stat().st_size < 500:  # Skip tiny files
            continue
        exchanges = parse_session_file(path)
        # Filter: keep exchanges with 1-50 tool calls
        for ex in exchanges:
            if 1 <= len(ex.tool_sequence) <= 50 and len(ex.user_intent) > 15:
                all_exchanges.append(ex)

    return all_exchanges


if __name__ == "__main__":
    sessions_dir = Path("/Users/skylar/.claude/projects/-Users-skylar-nuke/")
    exchanges = parse_all_sessions(sessions_dir)
    print(f"Parsed {len(exchanges)} usable exchanges")
    from collections import Counter
    cats = Counter(e.category_hint for e in exchanges)
    for cat, count in cats.most_common():
        print(f"  {cat}: {count}")
    if exchanges:
        ex = exchanges[0]
        print(f"\nSample exchange:")
        print(f"  Intent: {ex.user_intent[:100]}")
        print(f"  Tools: {ex.tool_sequence[:5]}")
        print(f"  Category: {ex.category_hint}")
