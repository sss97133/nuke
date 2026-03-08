#!/usr/bin/env python3
"""
Telegram bot for checking in on Claude Code sessions.
You message it when YOU want updates - it doesn't spam you.

Commands:
  /status - Get current Claude sessions and recent activity
  /logs - Get recent work log entries
  /errors - Show only errors/blockers
  /sessions - List active Claude sessions
"""
import os
import json
import subprocess
from pathlib import Path
from datetime import datetime
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes

# Load env
env_file = Path("/Users/skylar/nuke/.env")
if env_file.exists():
    for line in env_file.read_text().splitlines():
        if line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip('"').strip("'"))

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
CLAUDE_DIR = Path.home() / ".claude"
WORK_LOG = Path("/Users/skylar/nuke/.claude/work_log.jsonl")

async def status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Get overall status."""
    lines = ["📊 *Claude Status*\n"]

    # Check for running Claude processes
    try:
        result = subprocess.run(
            ["pgrep", "-fl", "claude"],
            capture_output=True, text=True, timeout=5
        )
        procs = [l for l in result.stdout.strip().split("\n") if l and "pgrep" not in l]
        if procs:
            lines.append(f"🟢 *{len(procs)} Claude process(es) running*")
        else:
            lines.append("⚪ No Claude processes running")
    except:
        lines.append("❓ Could not check processes")

    # Recent sessions
    sessions_idx = CLAUDE_DIR / "projects/-Users-skylar-nuke/sessions-index.json"
    if sessions_idx.exists():
        try:
            data = json.loads(sessions_idx.read_text())
            entries = data.get("entries", [])[-3:]
            if entries:
                lines.append("\n*Recent sessions:*")
                for e in reversed(entries):
                    prompt = e.get("firstPrompt", "")[:60]
                    modified = e.get("modified", "")[:16]
                    lines.append(f"• `{modified}` {prompt}...")
        except:
            pass

    # Recent work log
    if WORK_LOG.exists():
        try:
            recent = WORK_LOG.read_text().strip().split("\n")[-5:]
            if recent and recent[0]:
                lines.append("\n*Recent work:*")
                for entry in reversed(recent):
                    try:
                        e = json.loads(entry)
                        lines.append(f"• {e.get('summary', 'work done')[:50]}")
                    except:
                        pass
        except:
            pass

    # Queue status
    try:
        result = subprocess.run(
            ["bash", "-c", "cd /Users/skylar/nuke && dotenvx run --quiet -- bash -c 'curl -s \"$VITE_SUPABASE_URL/rest/v1/import_queue?select=status&limit=1000\" -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" -H \"apikey: $SUPABASE_SERVICE_ROLE_KEY\"' 2>/dev/null"],
            capture_output=True, text=True, timeout=15
        )
        if result.stdout:
            items = json.loads(result.stdout)
            counts = {}
            for i in items:
                s = i.get("status", "unknown")
                counts[s] = counts.get(s, 0) + 1
            if counts:
                lines.append(f"\n*Queue:* {counts}")
    except:
        pass

    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")

async def logs(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Get recent work log."""
    if not WORK_LOG.exists():
        await update.message.reply_text("No work log yet.")
        return

    try:
        recent = WORK_LOG.read_text().strip().split("\n")[-10:]
        lines = ["📝 *Recent Work Log*\n"]
        for entry in reversed(recent):
            try:
                e = json.loads(entry)
                ts = e.get("timestamp", "")[:16]
                summary = e.get("summary", "")[:80]
                lines.append(f"`{ts}` {summary}")
            except:
                pass
        await update.message.reply_text("\n".join(lines), parse_mode="Markdown")
    except Exception as ex:
        await update.message.reply_text(f"Error reading log: {ex}")

async def errors(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show recent errors only."""
    lines = ["🔴 *Recent Errors*\n"]

    # Check debug log for errors
    debug_latest = CLAUDE_DIR / "debug/latest"
    if debug_latest.exists():
        try:
            result = subprocess.run(
                ["grep", "-i", "error", str(debug_latest)],
                capture_output=True, text=True, timeout=5
            )
            errs = result.stdout.strip().split("\n")[-5:]
            for e in errs:
                if e:
                    lines.append(f"• `{e[:100]}`")
        except:
            pass

    if len(lines) == 1:
        lines.append("No recent errors found ✓")

    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")

async def sessions(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """List Claude sessions."""
    sessions_idx = CLAUDE_DIR / "projects/-Users-skylar-nuke/sessions-index.json"
    if not sessions_idx.exists():
        await update.message.reply_text("No sessions found.")
        return

    try:
        data = json.loads(sessions_idx.read_text())
        entries = data.get("entries", [])[-10:]
        lines = ["📋 *Recent Sessions*\n"]
        for e in reversed(entries):
            sid = e.get("sessionId", "")[:8]
            prompt = e.get("firstPrompt", "")[:50]
            modified = e.get("modified", "")[:10]
            lines.append(f"• `{sid}` ({modified}) {prompt}...")
        await update.message.reply_text("\n".join(lines), parse_mode="Markdown")
    except Exception as ex:
        await update.message.reply_text(f"Error: {ex}")

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle free-form messages."""
    # Print chat ID for setup
    print(f"Message from chat_id: {update.effective_chat.id}")

    text = update.message.text.lower().strip()

    if any(w in text for w in ["status", "how", "going", "what's up", "update"]):
        await status(update, context)
    elif any(w in text for w in ["error", "fail", "wrong", "broken"]):
        await errors(update, context)
    elif any(w in text for w in ["log", "done", "finished", "completed"]):
        await logs(update, context)
    else:
        await update.message.reply_text(
            "Commands:\n"
            "/status - Overall status\n"
            "/logs - Recent work\n"
            "/errors - Recent errors\n"
            "/sessions - Claude sessions"
        )

def main():
    if not BOT_TOKEN:
        print("Set TELEGRAM_BOT_TOKEN in .env")
        return

    app = Application.builder().token(BOT_TOKEN).build()

    app.add_handler(CommandHandler("status", status))
    app.add_handler(CommandHandler("logs", logs))
    app.add_handler(CommandHandler("errors", errors))
    app.add_handler(CommandHandler("sessions", sessions))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    print("Bot running - message @Sss97133_bot to check in")
    app.run_polling()

if __name__ == "__main__":
    main()
