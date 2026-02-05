#!/usr/bin/env python3
"""
Claude Code Permission Request Hook -> Telegram Approval

This hook intercepts Claude Code permission requests and routes them
to Telegram for remote approval. Supports detailed responses.

Input (stdin): JSON from Claude Code PermissionRequest hook
Output (stdout): JSON with hookSpecificOutput decision

Flow:
1. Parse permission request from Claude
2. Create approval request in database
3. Send formatted message to Telegram
4. Poll database for user response (with timeout)
5. Return decision to Claude
"""

import os
import sys
import json
import time
import urllib.request
import urllib.parse
from pathlib import Path
from datetime import datetime

# Load environment
NUKE_DIR = Path("/Users/skylar/nuke")
env_file = NUKE_DIR / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        if line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip('"').strip("'"))

# Configuration
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "7587296683")
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# Timeouts
POLL_INTERVAL = 1  # seconds
MAX_WAIT_TIME = 600  # 10 minutes
TELEGRAM_TIMEOUT = 10

def log(msg: str):
    """Log to stderr (doesn't interfere with JSON output)."""
    print(f"[telegram-approval] {msg}", file=sys.stderr)

def supabase_rpc(function_name: str, params: dict) -> dict:
    """Call a Supabase RPC function."""
    url = f"{SUPABASE_URL}/rest/v1/rpc/{function_name}"
    data = json.dumps(params).encode()

    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Authorization', f'Bearer {SUPABASE_KEY}')
    req.add_header('apikey', SUPABASE_KEY)
    req.add_header('Content-Type', 'application/json')

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        log(f"Supabase RPC error: {e}")
        return {"error": str(e)}

def send_telegram(text: str, reply_markup: dict = None) -> dict:
    """Send a message to Telegram, optionally with inline keyboard."""
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": CHAT_ID,
        "text": text,
        "parse_mode": "Markdown"
    }
    if reply_markup:
        payload["reply_markup"] = json.dumps(reply_markup)

    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Content-Type', 'application/json')

    try:
        with urllib.request.urlopen(req, timeout=TELEGRAM_TIMEOUT) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        log(f"Telegram error: {e}")
        return {"ok": False, "error": str(e)}

def edit_telegram_message(message_id: int, text: str, button_text: str) -> dict:
    """Edit a Telegram message to show confirmed button."""
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/editMessageText"
    payload = {
        "chat_id": CHAT_ID,
        "message_id": message_id,
        "text": text,
        "parse_mode": "Markdown",
        "reply_markup": {"inline_keyboard": [[{"text": button_text, "callback_data": "done"}]]}
    }

    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Content-Type', 'application/json')

    try:
        with urllib.request.urlopen(req, timeout=TELEGRAM_TIMEOUT) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        log(f"Telegram edit error: {e}")
        return {"ok": False, "error": str(e)}

def format_tool_description(tool_name: str, tool_input: dict) -> str:
    """Create a human-readable description of the tool action."""
    if tool_name == "Bash":
        cmd = tool_input.get("command", "")
        desc = tool_input.get("description", "")

        # Analyze command for risk level
        risky_patterns = ['rm ', 'sudo', 'chmod 777', '> /', 'dd ', 'mkfs', ':(){', 'fork']
        is_risky = any(p in cmd.lower() for p in risky_patterns)

        # Format nicely
        risk_indicator = "⚠️ *POTENTIALLY RISKY*\n" if is_risky else ""

        if desc:
            return f"{risk_indicator}*Command:* {desc}\n```bash\n{cmd[:800]}\n```"
        else:
            # Try to summarize what the command does
            if cmd.startswith("curl"):
                return f"{risk_indicator}*HTTP Request*\n```bash\n{cmd[:800]}\n```"
            elif cmd.startswith("git"):
                return f"{risk_indicator}*Git Operation*\n```bash\n{cmd[:800]}\n```"
            elif "psql" in cmd or "supabase" in cmd:
                return f"{risk_indicator}*Database Operation*\n```bash\n{cmd[:800]}\n```"
            else:
                return f"{risk_indicator}*Shell Command*\n```bash\n{cmd[:800]}\n```"

    elif tool_name == "Edit":
        path = tool_input.get("file_path", "unknown")
        old = tool_input.get("old_string", "")
        new = tool_input.get("new_string", "")

        # Get filename
        filename = path.split("/")[-1] if "/" in path else path

        # Calculate change size
        lines_removed = old.count('\n') + 1
        lines_added = new.count('\n') + 1

        msg = f"*Edit File:* `{filename}`\n"
        msg += f"_Path:_ `{path}`\n\n"
        msg += f"📤 *Remove* ({lines_removed} lines):\n```\n{old[:300]}{'...' if len(old) > 300 else ''}\n```\n\n"
        msg += f"📥 *Add* ({lines_added} lines):\n```\n{new[:300]}{'...' if len(new) > 300 else ''}\n```"
        return msg

    elif tool_name == "Write":
        path = tool_input.get("file_path", "unknown")
        content = tool_input.get("content", "")
        filename = path.split("/")[-1] if "/" in path else path

        # Check if file exists
        from pathlib import Path
        exists = Path(path).exists() if path != "unknown" else False

        action = "📝 *Overwrite*" if exists else "📄 *Create New File*"
        lines = content.count('\n') + 1

        msg = f"{action}: `{filename}`\n"
        msg += f"_Path:_ `{path}`\n"
        msg += f"_Size:_ {len(content)} chars, {lines} lines\n\n"
        msg += f"*Preview:*\n```\n{content[:400]}{'...' if len(content) > 400 else ''}\n```"
        return msg

    elif tool_name == "Read":
        path = tool_input.get("file_path", "unknown")
        filename = path.split("/")[-1] if "/" in path else path
        return f"📖 *Read File:* `{filename}`\n_Path:_ `{path}`"

    elif tool_name.startswith("mcp__"):
        # MCP tool - parse server and function
        parts = tool_name.split("__")
        server = parts[1] if len(parts) > 1 else "unknown"
        func = parts[2] if len(parts) > 2 else tool_name

        server_emoji = {
            "supabase": "🗄️",
            "firecrawl": "🔥",
            "playwright": "🎭"
        }.get(server, "🔌")

        msg = f"{server_emoji} *MCP: {server}*\n"
        msg += f"*Function:* `{func}`\n\n"

        # Format input nicely
        input_str = json.dumps(tool_input, indent=2)
        msg += f"*Input:*\n```json\n{input_str[:500]}{'...' if len(input_str) > 500 else ''}\n```"
        return msg

    elif tool_name == "WebFetch":
        url = tool_input.get("url", "unknown")
        prompt = tool_input.get("prompt", "")
        return f"🌐 *Web Fetch*\n*URL:* `{url}`\n*Prompt:* {prompt[:200]}"

    elif tool_name == "WebSearch":
        query = tool_input.get("query", "unknown")
        return f"🔍 *Web Search*\n*Query:* `{query}`"

    else:
        return f"🔧 *Tool:* `{tool_name}`\n*Input:*\n```json\n{json.dumps(tool_input, indent=2)[:500]}\n```"

def create_approval_request(session_id: str, tool_name: str, tool_input: dict,
                            description: str, context: dict) -> tuple:
    """Create an approval request in the database."""
    # Use the RPC function we created
    result = supabase_rpc("create_approval_request", {
        "p_session_id": session_id,
        "p_tool_name": tool_name,
        "p_tool_input": tool_input,
        "p_description": description,
        "p_context": context,
        "p_chat_id": int(CHAT_ID),
        "p_expires_minutes": 10
    })

    if isinstance(result, list) and len(result) > 0:
        return result[0].get("request_id"), result[0].get("id")
    elif isinstance(result, dict) and "request_id" in result:
        return result.get("request_id"), result.get("id")

    log(f"Create approval failed: {result}")
    return None, None

def poll_for_response(request_id: str) -> tuple:
    """Poll the database for approval response. Returns (status, response_text, response_data, telegram_message_id)."""
    start_time = time.time()

    while time.time() - start_time < MAX_WAIT_TIME:
        result = supabase_rpc("poll_approval_response", {"p_request_id": request_id})

        if isinstance(result, list) and len(result) > 0:
            result = result[0]

        status = result.get("status", "pending")
        msg_id = result.get("telegram_message_id")

        if status in ("approved", "denied"):
            return status, result.get("response_text"), result.get("response_data"), msg_id
        elif status == "expired":
            return "expired", None, None, msg_id
        elif status == "not_found":
            log(f"Request {request_id} not found")
            return "error", None, None, None

        time.sleep(POLL_INTERVAL)

    return "timeout", None, None, None

def output_decision(behavior: str, message: str = None, updated_input: dict = None):
    """Output the decision JSON to stdout."""
    decision = {"behavior": behavior}
    if message:
        decision["message"] = message
    if updated_input:
        decision["updatedInput"] = updated_input

    output = {
        "hookSpecificOutput": {
            "hookEventName": "PermissionRequest",
            "decision": decision
        }
    }
    print(json.dumps(output))
    sys.exit(0)

def main():
    # Check configuration
    if not all([BOT_TOKEN, CHAT_ID, SUPABASE_URL, SUPABASE_KEY]):
        log("Missing configuration - approving by default")
        output_decision("allow")

    # Read hook input from stdin
    try:
        hook_data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        log(f"Invalid JSON input: {e}")
        output_decision("allow")

    # Extract request details
    session_id = hook_data.get("session_id", "unknown")
    tool_name = hook_data.get("tool_name", "unknown")
    tool_input = hook_data.get("tool_input", {})
    cwd = hook_data.get("cwd", "")
    permission_mode = hook_data.get("permission_mode", "default")

    # Skip if already in bypass mode
    if permission_mode == "bypassPermissions":
        output_decision("allow")

    # Create human-readable description
    description = format_tool_description(tool_name, tool_input)

    # Context for the approval request
    context = {
        "cwd": cwd,
        "session_id_short": session_id[:8] if session_id else "",
        "timestamp": datetime.now().isoformat()
    }

    # Create approval request in database
    request_id, db_id = create_approval_request(
        session_id, tool_name, tool_input, description, context
    )

    if not request_id:
        log("Failed to create approval request - approving by default")
        output_decision("allow")

    # Send Telegram message
    emoji_map = {
        "Bash": "💻",
        "Edit": "✏️",
        "Write": "📝",
        "Read": "📖",
        "WebFetch": "🌐",
        "WebSearch": "🔍"
    }
    emoji = emoji_map.get(tool_name, "🔧")

    # Get project context from cwd
    project = "nuke" if "nuke" in cwd else cwd.split("/")[-1][:20]

    # Format working directory nicely
    cwd_display = cwd.replace("/Users/skylar/nuke/", "~/nuke/")
    if len(cwd_display) > 40:
        cwd_display = "..." + cwd_display[-37:]

    message = f"""{emoji} *Claude Permission Request*

{description}

━━━━━━━━━━━━━━━━━━
📁 `{cwd_display}`
🆔 `{request_id}`
━━━━━━━━━━━━━━━━━━

*Quick Reply:*
`{request_id} yes` ✅ Approve
`{request_id} no` ❌ Deny
`{request_id} <message>` 💬 Approve with instructions

⏰ _Expires in 10 minutes_"""

    # Inline keyboard for quick actions
    keyboard = {
        "inline_keyboard": [
            [
                {"text": "✅ Approve", "callback_data": f"approve_{request_id}"},
                {"text": "❌ Deny", "callback_data": f"deny_{request_id}"}
            ],
            [
                {"text": "✅ Allow All (this session)", "callback_data": f"allow_all_{request_id}"}
            ]
        ]
    }

    result = send_telegram(message, keyboard)
    if result.get("ok"):
        msg_id = result.get("result", {}).get("message_id")
        log(f"Telegram message sent: {msg_id}")

        # Update the approval request with message ID
        if msg_id and db_id:
            try:
                url = f"{SUPABASE_URL}/rest/v1/claude_approval_requests?id=eq.{db_id}"
                data = json.dumps({"telegram_message_id": msg_id}).encode()
                req = urllib.request.Request(url, data=data, method='PATCH')
                req.add_header('Authorization', f'Bearer {SUPABASE_KEY}')
                req.add_header('apikey', SUPABASE_KEY)
                req.add_header('Content-Type', 'application/json')
                urllib.request.urlopen(req, timeout=5)
            except:
                pass
    else:
        log(f"Telegram send failed: {result}")

    # Poll for response
    log(f"Waiting for approval: {request_id}")
    status, response_text, response_data, msg_id = poll_for_response(request_id)

    if status == "approved":
        log(f"Request {request_id} approved")
        if response_text:
            log(f"User response: {response_text}")
        # Edit original message to show confirmed button
        if msg_id:
            edit_telegram_message(msg_id, f"✅ *APPROVED*\n\n`{request_id}`\n\n_Claude continuing..._", "✅ Confirmed")
        output_decision("allow")

    elif status == "denied":
        log(f"Request {request_id} denied")
        # Edit original message to show denied button
        if msg_id:
            edit_telegram_message(msg_id, f"❌ *DENIED*\n\n`{request_id}`", "❌ Denied")
        deny_msg = response_text or "Permission denied via Telegram"
        output_decision("deny", deny_msg)

    elif status == "timeout":
        log(f"Request {request_id} timed out")
        # Edit original message to show timeout
        if msg_id:
            edit_telegram_message(msg_id, f"⏰ *TIMED OUT*\n\n`{request_id}`", "⏰ Expired")
        output_decision("deny", "Approval request timed out")

    else:
        log(f"Request {request_id} status: {status}")
        output_decision("deny", f"Approval error: {status}")

if __name__ == "__main__":
    main()
