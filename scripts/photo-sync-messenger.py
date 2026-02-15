#!/usr/bin/env python3
"""
Multi-channel messaging for Nuke Photo Auto-Sync.
Supports: iMessage, Twilio SMS, WhatsApp (via Twilio), Telegram.
"""

import os
import json
import sqlite3
import subprocess
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, List

import requests

logger = logging.getLogger('photo-sync-messenger')

# ============================================================================
# CONFIGURATION
# ============================================================================

TWILIO_SID = os.getenv('TWILIO_ACCOUNT_SID')
TWILIO_TOKEN = os.getenv('TWILIO_AUTH_TOKEN')
TWILIO_PHONE = os.getenv('TWILIO_PHONE_NUMBER')
TWILIO_WHATSAPP = os.getenv('TWILIO_WHATSAPP_NUMBER')
TELEGRAM_TOKEN = os.getenv('NUKE_TELEGRAM_BOT_TOKEN') or os.getenv('TELEGRAM_BOT_TOKEN')
SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
CHAT_DB = Path.home() / 'Library' / 'Messages' / 'chat.db'


# ============================================================================
# iMESSAGE
# ============================================================================

def send_imessage(recipient: str, message: str) -> bool:
    """Send iMessage via AppleScript. recipient = phone (+1...) or email."""
    safe_msg = message.replace('\\', '\\\\').replace('"', '\\"')
    safe_recipient = recipient.replace('"', '\\"')

    script = f'''
    tell application "Messages"
        set targetService to 1st account whose service type = iMessage
        set targetBuddy to participant "{safe_recipient}" of targetService
        send "{safe_msg}" to targetBuddy
    end tell
    '''

    try:
        result = subprocess.run(
            ['osascript', '-e', script],
            capture_output=True, text=True, timeout=15
        )
        if result.returncode == 0:
            logger.info(f"iMessage sent to {recipient[:6]}...")
            return True
        else:
            logger.warning(f"iMessage failed: {result.stderr[:200]}")
            return False
    except subprocess.TimeoutExpired:
        logger.warning("iMessage send timed out")
        return False
    except Exception as e:
        logger.error(f"iMessage error: {e}")
        return False


def read_imessage_replies(from_identifier: str, since_timestamp: float) -> List[Dict]:
    """
    Read incoming iMessages from a specific sender since a timestamp.
    Requires Full Disk Access for the running process.
    """
    if not CHAT_DB.exists():
        logger.warning(f"chat.db not found at {CHAT_DB}")
        return []

    try:
        conn = sqlite3.connect(str(CHAT_DB), check_same_thread=False)
        conn.row_factory = sqlite3.Row

        # Apple Messages stores dates as nanoseconds since 2001-01-01
        # Convert unix timestamp to Apple epoch
        apple_epoch_offset = 978307200  # seconds between 1970 and 2001
        apple_ns = int((since_timestamp - apple_epoch_offset) * 1e9)

        # Normalize phone for matching (last 10 digits)
        phone_suffix = from_identifier.replace('+', '').replace('-', '').replace(' ', '')[-10:]

        query = '''
        SELECT
            m.text,
            m.date / 1000000000 + 978307200 as unix_timestamp,
            m.is_from_me,
            h.id as sender
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        WHERE h.id LIKE ?
          AND m.is_from_me = 0
          AND m.date > ?
          AND m.text IS NOT NULL
        ORDER BY m.date ASC
        LIMIT 20
        '''

        rows = conn.execute(query, (f'%{phone_suffix}%', apple_ns)).fetchall()
        conn.close()

        return [
            {'text': r['text'], 'timestamp': r['unix_timestamp'], 'sender': r['sender']}
            for r in rows
        ]
    except sqlite3.OperationalError as e:
        if 'locked' in str(e).lower() or 'permission' in str(e).lower():
            logger.warning("Cannot read chat.db - Full Disk Access may be needed")
        else:
            logger.error(f"chat.db read error: {e}")
        return []
    except Exception as e:
        logger.error(f"iMessage read error: {e}")
        return []


# ============================================================================
# TWILIO SMS
# ============================================================================

def send_sms(to_phone: str, message: str) -> Optional[str]:
    """Send SMS via Twilio. Returns message SID on success."""
    if not all([TWILIO_SID, TWILIO_TOKEN, TWILIO_PHONE]):
        logger.warning("Twilio not configured (missing SID/TOKEN/PHONE)")
        return None

    try:
        resp = requests.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json",
            auth=(TWILIO_SID, TWILIO_TOKEN),
            data={
                "To": to_phone,
                "From": TWILIO_PHONE,
                "Body": message
            },
            timeout=15
        )
        if resp.status_code in (200, 201):
            sid = resp.json().get('sid')
            logger.info(f"SMS sent to {to_phone[:6]}... SID={sid}")
            return sid
        else:
            logger.warning(f"SMS failed ({resp.status_code}): {resp.text[:200]}")
            return None
    except Exception as e:
        logger.error(f"SMS error: {e}")
        return None


# ============================================================================
# WHATSAPP (via Twilio)
# ============================================================================

def send_whatsapp(to_phone: str, message: str) -> Optional[str]:
    """Send WhatsApp message via Twilio API. Returns message SID."""
    if not all([TWILIO_SID, TWILIO_TOKEN]):
        logger.warning("Twilio not configured for WhatsApp")
        return None

    from_number = TWILIO_WHATSAPP or TWILIO_PHONE
    if not from_number:
        logger.warning("No WhatsApp sender number configured")
        return None

    try:
        resp = requests.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json",
            auth=(TWILIO_SID, TWILIO_TOKEN),
            data={
                "To": f"whatsapp:{to_phone}",
                "From": f"whatsapp:{from_number}",
                "Body": message
            },
            timeout=15
        )
        if resp.status_code in (200, 201):
            sid = resp.json().get('sid')
            logger.info(f"WhatsApp sent to {to_phone[:6]}... SID={sid}")
            return sid
        else:
            logger.warning(f"WhatsApp failed ({resp.status_code}): {resp.text[:200]}")
            return None
    except Exception as e:
        logger.error(f"WhatsApp error: {e}")
        return None


# ============================================================================
# TELEGRAM
# ============================================================================

def send_telegram(chat_id: int, message: str, image_url: str = None) -> Optional[int]:
    """Send Telegram message. Returns message_id on success."""
    if not TELEGRAM_TOKEN:
        logger.warning("Telegram bot token not configured")
        return None

    try:
        if image_url:
            resp = requests.post(
                f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendPhoto",
                json={"chat_id": chat_id, "photo": image_url, "caption": message},
                timeout=15
            )
        else:
            resp = requests.post(
                f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
                json={"chat_id": chat_id, "text": message, "parse_mode": "Markdown"},
                timeout=15
            )

        if resp.status_code == 200:
            msg_id = resp.json().get('result', {}).get('message_id')
            logger.info(f"Telegram sent to chat {chat_id}, msg_id={msg_id}")
            return msg_id
        else:
            logger.warning(f"Telegram failed ({resp.status_code}): {resp.text[:200]}")
            return None
    except Exception as e:
        logger.error(f"Telegram error: {e}")
        return None


# ============================================================================
# UNIFIED DISPATCHER
# ============================================================================

class MessageDispatcher:
    """Dispatches messages via user's preferred channel with fallback."""

    def __init__(self, user_prefs: Dict):
        self.preferred = user_prefs.get('preferred_channel', 'imessage')
        self.fallback = user_prefs.get('fallback_channel', 'sms')
        self.phone = user_prefs.get('phone_number')
        self.imessage_addr = user_prefs.get('imessage_address') or self.phone
        self.telegram_chat_id = user_prefs.get('telegram_chat_id')
        self.quiet_start = user_prefs.get('quiet_start_hour', 22)
        self.quiet_end = user_prefs.get('quiet_end_hour', 7)
        self.tz = user_prefs.get('timezone', 'America/Los_Angeles')
        self.max_per_hour = user_prefs.get('max_messages_per_hour', 3)
        self.max_per_day = user_prefs.get('max_messages_per_day', 10)
        self._sent_times: List[float] = []

    def is_quiet_hours(self) -> bool:
        """Check if current time is in quiet hours."""
        try:
            import pytz
            tz = pytz.timezone(self.tz)
            now = datetime.now(tz)
        except (ImportError, Exception):
            now = datetime.now()

        hour = now.hour
        if self.quiet_start > self.quiet_end:
            return hour >= self.quiet_start or hour < self.quiet_end
        return self.quiet_start <= hour < self.quiet_end

    def is_throttled(self) -> bool:
        """Check if we've hit rate limits."""
        now = datetime.now(timezone.utc).timestamp()
        hour_ago = now - 3600
        day_ago = now - 86400

        recent_hour = sum(1 for t in self._sent_times if t > hour_ago)
        recent_day = sum(1 for t in self._sent_times if t > day_ago)

        return recent_hour >= self.max_per_hour or recent_day >= self.max_per_day

    def send(self, message: str, image_url: str = None, force: bool = False) -> Dict:
        """
        Send a message via preferred channel with fallback.
        Returns { success, channel, external_id }
        """
        if not force and self.is_quiet_hours():
            logger.info("Quiet hours - message queued")
            return {'success': False, 'channel': None, 'reason': 'quiet_hours'}

        if not force and self.is_throttled():
            logger.info("Rate limit hit - message queued")
            return {'success': False, 'channel': None, 'reason': 'throttled'}

        channels_to_try = [self.preferred]
        if self.fallback and self.fallback != self.preferred:
            channels_to_try.append(self.fallback)

        for channel in channels_to_try:
            result = self._send_via(channel, message, image_url)
            if result['success']:
                self._sent_times.append(datetime.now(timezone.utc).timestamp())
                return result

        return {'success': False, 'channel': None, 'reason': 'all_channels_failed'}

    def _send_via(self, channel: str, message: str, image_url: str = None) -> Dict:
        """Attempt send via a specific channel."""
        if channel == 'imessage' and self.imessage_addr:
            ok = send_imessage(self.imessage_addr, message)
            return {'success': ok, 'channel': 'imessage', 'external_id': None}

        elif channel == 'sms' and self.phone:
            sid = send_sms(self.phone, message)
            return {'success': sid is not None, 'channel': 'sms', 'external_id': sid}

        elif channel == 'whatsapp' and self.phone:
            sid = send_whatsapp(self.phone, message)
            return {'success': sid is not None, 'channel': 'whatsapp', 'external_id': sid}

        elif channel == 'telegram' and self.telegram_chat_id:
            msg_id = send_telegram(self.telegram_chat_id, message, image_url)
            return {'success': msg_id is not None, 'channel': 'telegram', 'external_id': str(msg_id) if msg_id else None}

        return {'success': False, 'channel': channel, 'reason': 'not_configured'}


def load_user_prefs(user_id: str) -> Dict:
    """Load user sync preferences from Supabase."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return {}

    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/user_sync_preferences",
            headers={
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
            },
            params={'user_id': f'eq.{user_id}', 'limit': '1'},
            timeout=10
        )
        if resp.status_code == 200 and resp.json():
            return resp.json()[0]
    except Exception as e:
        logger.error(f"Failed to load prefs: {e}")

    return {}


def create_dispatcher(user_id: str) -> MessageDispatcher:
    """Create a MessageDispatcher for a user."""
    prefs = load_user_prefs(user_id)
    return MessageDispatcher(prefs)


# ============================================================================
# CLARIFICATION MESSAGE BUILDER
# ============================================================================

def build_clarification_message(
    total_photos: int,
    matched: List[Dict],  # [{vehicle_title, count}]
    unmatched_count: int,
    vehicle_hints: Dict = None,  # {make, model, year, color}
    candidates: List[Dict] = None  # [{vehicle_title, vehicle_id}]
) -> str:
    """Build a human-friendly clarification message."""
    lines = [f"Nuke Photo Sync: {total_photos} new photos processed."]

    if matched:
        for m in matched[:5]:
            lines.append(f"  {m['count']} -> {m['vehicle_title']}")

    if unmatched_count > 0:
        lines.append("")
        hint_desc = ""
        if vehicle_hints:
            parts = []
            if vehicle_hints.get('color'):
                parts.append(vehicle_hints['color'])
            if vehicle_hints.get('year'):
                parts.append(str(vehicle_hints['year']))
            if vehicle_hints.get('make'):
                parts.append(vehicle_hints['make'])
            if vehicle_hints.get('model'):
                parts.append(vehicle_hints['model'])
            hint_desc = ' '.join(parts)

        if hint_desc:
            lines.append(f"{unmatched_count} photos show a {hint_desc} I don't recognize.")
        else:
            lines.append(f"{unmatched_count} photos need your help to sort.")

        if candidates:
            lines.append("Is this:")
            for i, c in enumerate(candidates[:4], 1):
                lines.append(f"  {i}. {c['vehicle_title']}")
            lines.append(f"  {len(candidates[:4]) + 1}. A new vehicle")
            lines.append(f"  {len(candidates[:4]) + 2}. Skip these")
        else:
            lines.append("Reply with a vehicle name or 'new' to create a profile.")

    return '\n'.join(lines)
