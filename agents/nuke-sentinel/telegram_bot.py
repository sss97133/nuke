#!/usr/bin/env python3
"""
Telegram Bot for Nuke - Intelligent Image Upload Agent
Uses polling to check for new messages (more reliable than events for channels)
"""

import os
import json
import asyncio
import subprocess
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, Dict, List, Any
import urllib.request

from telethon import TelegramClient
from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS
from pillow_heif import register_heif_opener

# Enable HEIC/HEIF support in Pillow
register_heif_opener()
from telethon.tl.types import MessageMediaPhoto, MessageMediaDocument

AGENT_DIR = Path(__file__).parent
SESSION_FILE = AGENT_DIR / "telegram_session"
UPLOAD_DIR = AGENT_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
STATE_FILE = AGENT_DIR / ".bot_state.json"

API_ID = int(os.getenv("TELEGRAM_API_ID", "30178208"))
API_HASH = os.getenv("TELEGRAM_API_HASH", "87ba8d78ccf937ea9f581be85f8b58a9")
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
XAI_API_KEY = os.getenv("XAI_API_KEY")

CHANNEL_ID = 3813097515  # Nukegpt channel

# Discussion intent patterns - when user wants to TALK about images, not just save them
DISCUSSION_PATTERNS = [
    'what do i need', 'what needs', 'whats wrong', "what's wrong", 'what should i',
    'how much', 'cost', 'budget', 'price', 'estimate', 'quote',
    'priority', 'prioritize', 'urgent', 'critical', 'first',
    'parts list', 'shopping list', 'order', 'buy',
    'fix', 'repair', 'replace', 'broken', 'worn', 'damaged',
    'inspect', 'check', 'look at', 'thoughts', 'opinion', 'advice',
    'plan', 'next steps', 'todo', 'to do', 'work on',
    '?'  # Any question mark indicates discussion intent
]


class ConversationState:
    """Track conversation context."""
    def __init__(self):
        self.current_vehicle = None
        self.vehicle_title = None
        self.pending_images = []
        self.discussion_images = []  # Images being discussed (not saved yet)
        self.last_search_results = []
        self.awaiting = None
        self.last_message_id = 0
        self.conversation_history = []  # For multi-turn discussions
        self.load()

    def load(self):
        if STATE_FILE.exists():
            try:
                with open(STATE_FILE) as f:
                    data = json.load(f)
                    self.current_vehicle = data.get("current_vehicle")
                    self.vehicle_title = data.get("vehicle_title")
                    self.last_message_id = data.get("last_message_id", 0)
                    self.pending_images = data.get("pending_images", [])
                    self.discussion_images = data.get("discussion_images", [])
                    self.awaiting = data.get("awaiting")
                    self.conversation_history = data.get("conversation_history", [])
            except:
                pass

    def save(self):
        with open(STATE_FILE, 'w') as f:
            json.dump({
                "current_vehicle": self.current_vehicle,
                "vehicle_title": self.vehicle_title,
                "last_message_id": self.last_message_id,
                "pending_images": self.pending_images,
                "discussion_images": self.discussion_images,
                "awaiting": self.awaiting,
                "conversation_history": self.conversation_history[-10:]  # Keep last 10 turns
            }, f)

    def add_to_conversation(self, role: str, content: str):
        """Add a message to conversation history."""
        self.conversation_history.append({
            "role": role,
            "content": content,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        self.save()

    def clear_discussion(self):
        """Clear discussion state after it's resolved."""
        self.discussion_images = []
        self.conversation_history = []
        self.save()


def extract_exif(filepath: Path) -> Dict[str, Any]:
    """Extract EXIF metadata including device identifiers for user association.

    Uses getexif() for compatibility with HEIC/HEIF files.
    """
    from PIL.ExifTags import IFD

    exif_data = {
        "timestamp": None,
        "gps": None,
        "camera_make": None,
        "camera_model": None,
        "software": None,
        "device_id": None,  # Best unique identifier for device association
        "body_serial": None,
        "camera_serial": None,
        "image_unique_id": None,
        "lens_info": None,
        "has_exif": False
    }

    try:
        img = Image.open(filepath)

        # Use getexif() for HEIC compatibility (not _getexif())
        exif = img.getexif()
        if not exif:
            return exif_data

        exif_data["has_exif"] = True

        # Process base EXIF tags
        for tag_id, value in exif.items():
            tag = TAGS.get(tag_id, tag_id)

            if tag == "Make":
                exif_data["camera_make"] = str(value)
            elif tag == "Model":
                exif_data["camera_model"] = str(value)
            elif tag == "Software":
                exif_data["software"] = str(value)

        # Get IFD Exif data (contains DateTimeOriginal, device serials, etc)
        try:
            ifd_exif = exif.get_ifd(IFD.Exif)
            for tag_id, value in ifd_exif.items():
                tag = TAGS.get(tag_id, tag_id)

                if tag == "DateTimeOriginal":
                    exif_data["timestamp"] = str(value)
                elif tag == "BodySerialNumber":
                    exif_data["body_serial"] = str(value)
                elif tag == "CameraSerialNumber":
                    exif_data["camera_serial"] = str(value)
                elif tag == "ImageUniqueID":
                    exif_data["image_unique_id"] = str(value)
                elif tag == "LensModel":
                    exif_data["lens_info"] = str(value)
        except Exception:
            pass

        # Get GPS data from IFD
        try:
            ifd_gps = exif.get_ifd(IFD.GPSInfo)
            if ifd_gps:
                # GPS tags use numeric keys: 1=LatRef, 2=Lat, 3=LonRef, 4=Lon
                lat_ref = ifd_gps.get(1)  # N or S
                lat_tuple = ifd_gps.get(2)  # (deg, min, sec)
                lon_ref = ifd_gps.get(3)  # E or W
                lon_tuple = ifd_gps.get(4)  # (deg, min, sec)

                if lat_tuple and lon_tuple:
                    lat = _convert_to_degrees(lat_tuple)
                    lon = _convert_to_degrees(lon_tuple)
                    if lat_ref == "S":
                        lat = -lat
                    if lon_ref == "W":
                        lon = -lon
                    exif_data["gps"] = {"lat": lat, "lon": lon}
        except Exception:
            pass

        # Build device identifier for user association
        # Priority: serial number > make+model+software fingerprint
        if exif_data["body_serial"]:
            exif_data["device_id"] = f"serial:{exif_data['body_serial']}"
        elif exif_data["camera_serial"]:
            exif_data["device_id"] = f"serial:{exif_data['camera_serial']}"
        elif exif_data["camera_make"] and exif_data["camera_model"]:
            fp = f"{exif_data['camera_make']}|{exif_data['camera_model']}"
            if exif_data["software"]:
                fp += f"|{exif_data['software']}"
            exif_data["device_id"] = f"fingerprint:{fp}"

    except Exception as e:
        print(f"  EXIF extraction error: {e}")

    return exif_data


def _convert_to_degrees(value):
    """Convert GPS coordinates to decimal degrees."""
    d = float(value[0])
    m = float(value[1])
    s = float(value[2])
    return d + (m / 60.0) + (s / 3600.0)


def has_discussion_intent(text: str) -> bool:
    """Check if the message indicates the user wants to discuss/analyze, not just save."""
    if not text:
        return False
    lower = text.lower()
    return any(pattern in lower for pattern in DISCUSSION_PATTERNS)


async def call_vehicle_expert(
    vehicle_id: str,
    question: str,
    image_urls: List[str] = None,
    conversation_history: List[Dict] = None
) -> Dict[str, Any]:
    """Call the vehicle-expert-agent for intelligent discussion."""
    try:
        url = f"{SUPABASE_URL}/functions/v1/vehicle-expert-agent"

        payload = {
            "vehicleId": vehicle_id,
            "question": question,
            "conversation_history": conversation_history or []
        }

        # If we have image URLs, include them in the question context
        if image_urls:
            image_context = f"\n\n[User shared {len(image_urls)} images for discussion]"
            payload["question"] = question + image_context

        data = json.dumps(payload).encode()

        req = urllib.request.Request(url, data=data, method='POST')
        req.add_header('Authorization', f'Bearer {SUPABASE_KEY}')
        req.add_header('Content-Type', 'application/json')

        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode())
            return result

    except Exception as e:
        print(f"  Expert agent error: {e}")
        return {"error": str(e), "response": "I couldn't process that right now. Try again?"}


async def analyze_images_for_parts(
    vehicle_id: str,
    image_ids: List[str] = None
) -> Dict[str, Any]:
    """Call recommend-parts-for-vehicle for direct parts analysis."""
    try:
        # Use the archived function (we'll un-archive it or call directly)
        url = f"{SUPABASE_URL}/functions/v1/recommend-parts-for-vehicle"

        payload = {
            "vehicle_id": vehicle_id,
            "image_ids": image_ids
        }

        data = json.dumps(payload).encode()

        req = urllib.request.Request(url, data=data, method='POST')
        req.add_header('Authorization', f'Bearer {SUPABASE_KEY}')
        req.add_header('Content-Type', 'application/json')

        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read().decode())
            return result

    except Exception as e:
        print(f"  Parts analysis error: {e}")
        return {"error": str(e)}


def format_parts_response(result: Dict) -> str:
    """Format parts recommendations for Telegram."""
    if result.get("error"):
        return f"Couldn't analyze: {result['error']}"

    if not result.get("recommendations"):
        return "No parts issues identified in these images."

    lines = [f"**{result.get('vehicle', 'Vehicle')} - Parts Assessment**\n"]

    # Group by priority
    by_priority = {}
    for rec in result.get("recommendations", []):
        priority = rec.get("priority", "medium")
        if priority not in by_priority:
            by_priority[priority] = []
        by_priority[priority].append(rec)

    priority_emoji = {
        "critical": "🔴",
        "high": "🟠",
        "medium": "🟡",
        "low": "🟢",
        "cosmetic": "⚪"
    }

    for priority in ["critical", "high", "medium", "low", "cosmetic"]:
        if priority in by_priority:
            lines.append(f"\n{priority_emoji.get(priority, '•')} **{priority.upper()}**")
            for rec in by_priority[priority]:
                cost = f" ~${rec['estimated_cost']}" if rec.get('estimated_cost') else ""
                lines.append(f"  • {rec['part_name']}{cost}")
                if rec.get('issue'):
                    lines.append(f"    _{rec['issue'][:60]}_")

    total = result.get("total_estimated_cost", 0)
    if total > 0:
        lines.append(f"\n**Estimated Total:** ${total:,.0f}")

    return "\n".join(lines)


def format_expert_response(result: Dict) -> str:
    """Format vehicle expert response for Telegram."""
    if result.get("error"):
        return result.get("response", "Something went wrong.")

    # Get the main response text
    response = result.get("response", "")

    # If there's structured UI data, extract key info
    ui = result.get("ui")
    if ui and isinstance(ui, dict):
        # Add estimate if present
        for card in ui.get("cards", []):
            if card.get("type") == "estimate":
                totals = card.get("totals", {})
                if totals.get("total_low") or totals.get("total_high"):
                    low = totals.get("total_low", 0)
                    high = totals.get("total_high", 0)
                    response += f"\n\n💰 **Estimate:** ${low:,.0f} - ${high:,.0f}"
                    if card.get("confidence"):
                        response += f" ({card['confidence']} confidence)"

            # Add parts options if present
            if card.get("type") == "parts_options":
                items = card.get("items", [])
                if items:
                    response += "\n\n**Parts needed:**"
                    for item in items[:5]:  # Limit to 5
                        response += f"\n• {item.get('name', 'Part')}"

    return response[:4000]  # Telegram limit


class NukeBot:
    def __init__(self):
        self.client = TelegramClient(str(SESSION_FILE), API_ID, API_HASH)
        self.state = ConversationState()
        self.me = None  # Set on start

    async def start(self):
        """Start the bot with polling."""
        await self.client.start()
        self.me = await self.client.get_me()
        print(f"✓ Bot running as: {self.me.username or self.me.first_name}")
        print(f"✓ Watching channel: Nukegpt ({CHANNEL_ID})")
        print(f"✓ Current vehicle: {self.state.vehicle_title or 'None'}")
        print(f"✓ Last seen message: {self.state.last_message_id}")
        print()
        print("Polling for messages... (Ctrl+C to stop)\n")
        await self.poll_loop()

    async def poll_loop(self, interval: int = 3):
        """Poll for new messages."""
        while True:
            try:
                await self.check_new_messages()
            except Exception as e:
                print(f"[Error] {e}")
            await asyncio.sleep(interval)

    async def check_new_messages(self):
        """Check for new messages since last check."""
        messages = await self.client.get_messages(
            CHANNEL_ID,
            limit=3,
            min_id=self.state.last_message_id
        )

        if not messages:
            return

        # Get highest ID first to avoid reprocessing
        max_id = max(m.id for m in messages)
        if max_id > self.state.last_message_id:
            self.state.last_message_id = max_id
            self.state.save()

        # Process only non-bot messages
        for msg in reversed(messages):
            # Skip bot's own messages (critical to prevent loops)
            if msg.sender_id == self.me.id:
                continue

            # Skip if no content
            if not msg.text and not msg.media:
                continue

            # Skip messages that look like bot responses
            if msg.text and ("No vehicles found" in msg.text or "✓" in msg.text or "📷" in msg.text):
                continue

            print(f"[{datetime.now().strftime('%H:%M:%S')}] Processing: {msg.text[:40] if msg.text else '(media)'}")
            await self.handle_message(msg)
            return  # Only process ONE message per cycle to avoid spam

    async def handle_message(self, msg):
        """Handle a message."""
        text = msg.text or ""
        has_media = bool(msg.media and isinstance(msg.media, (MessageMediaPhoto, MessageMediaDocument)))

        # Handle images (with or without text)
        if has_media:
            await self.handle_image(msg, text)
            return

        # Handle text-only messages
        lower = text.lower().strip()
        import re

        # Check if this is a discussion/question about previously sent images
        if has_discussion_intent(text) and (self.state.discussion_images or self.state.pending_images):
            await self.handle_discussion(text)
            return

        # Flexible image grabbing - detect intent, not exact commands
        image_words = ('image', 'images', 'photo', 'photos', 'pic', 'pics', 'picture', 'pictures')
        action_words = ('grab', 'get', 'save', 'upload', 'fetch', 'pull', 'catchup', 'catch up')

        has_image_word = any(w in lower for w in image_words)
        has_action_word = any(w in lower for w in action_words)

        # Extract number if present (e.g., "last 5", "grab 10")
        num_match = re.search(r'(\d+)', lower)

        if has_action_word and (has_image_word or num_match):
            count = int(num_match.group(1)) if num_match else 10
            await self.grab_recent_images(count)
            return

        # Check for confirmations (legacy - kept for pending images from old state)
        if self.state.awaiting == "image_confirm":
            if lower in ("yes", "y", "yeah", "yep", "confirm", "save", "do it", "ok"):
                await self.save_pending_images()
                return
            elif lower in ("no", "n", "nope", "cancel", "wrong"):
                self.state.pending_images = []
                self.state.awaiting = None
                self.state.save()
                await self.reply("Cancelled. Which vehicle should these go to?")
                return

        if self.state.awaiting == "vehicle_select":
            vehicle = await self.parse_vehicle_selection(text)
            if vehicle:
                self.state.current_vehicle = vehicle["id"]
                self.state.vehicle_title = vehicle["title"]
                self.state.awaiting = None
                self.state.save()

                # If we have pending images, save them automatically
                if self.state.pending_images:
                    await self.save_pending_images()
                else:
                    await self.reply(f"✓ Working on: **{vehicle['title']}**\n\nImages will auto-save.")
                return

        # If user has an active discussion, continue it
        if self.state.conversation_history and self.state.current_vehicle:
            await self.handle_discussion(text)
            return

        # Try to interpret as vehicle reference
        if text and not text.startswith('/'):
            results = await self.search_vehicles(text)
            if results:
                if len(results) == 1:
                    v = results[0]
                    self.state.current_vehicle = v["id"]
                    self.state.vehicle_title = v["title"]
                    self.state.save()

                    if self.state.pending_images:
                        # Auto-save pending images
                        await self.save_pending_images()
                    else:
                        await self.reply(f"✓ Working on: **{v['title']}**\n\nImages will auto-save.")
                else:
                    self.state.last_search_results = results
                    self.state.awaiting = "vehicle_select"
                    await self.reply(self.format_search_results(results))
            else:
                await self.reply(f"No vehicles found for '{text}'. Try year/make/model.")

    async def handle_discussion(self, question: str):
        """Handle a discussion/question about images or vehicle."""
        if not self.state.current_vehicle:
            await self.reply("Which vehicle are we discussing? Tell me the year/make/model.")
            return

        print(f"  💬 Discussion mode: {question[:50]}...")
        await self.reply("🤔 Analyzing...")

        # Add user message to history
        self.state.add_to_conversation("user", question)

        lower = question.lower()

        # Check if this is a parts-related question - use the parts analyzer
        parts_keywords = ['part', 'parts', 'cost', 'budget', 'price', 'buy', 'need', 'replace', 'fix', 'repair', 'estimate', 'quote']
        is_parts_question = any(kw in lower for kw in parts_keywords)

        if is_parts_question:
            # Use recommend-parts-for-vehicle (works with Anthropic)
            print(f"  🔧 Parts question detected - using parts analyzer...")
            result = await analyze_images_for_parts(
                vehicle_id=self.state.current_vehicle
            )
            response = format_parts_response(result)
        else:
            # Use vehicle expert agent for other questions
            image_urls = [img.get("url") for img in self.state.discussion_images if img.get("url")]
            result = await call_vehicle_expert(
                vehicle_id=self.state.current_vehicle,
                question=question,
                image_urls=image_urls,
                conversation_history=[
                    {"role": h["role"], "content": h["content"]}
                    for h in self.state.conversation_history[-6:]
                ]
            )
            response = format_expert_response(result)

        # Add assistant response to history
        self.state.add_to_conversation("assistant", response)

        await self.reply(response)

        # Log the interaction
        self.log_discussion(question, response, result)

    async def handle_image(self, msg, accompanying_text: str = ""):
        """Handle image upload - auto-saves if vehicle is set, or starts discussion if question."""
        # Detect if sent as document (file) vs photo
        is_document = isinstance(msg.media, MessageMediaDocument)
        is_photo = isinstance(msg.media, MessageMediaPhoto)

        # Check if user wants to discuss these images (not just save)
        wants_discussion = has_discussion_intent(accompanying_text)

        # Download image
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        ext = "jpg"

        # For documents, try to get original filename/extension
        if is_document and hasattr(msg.media, 'document'):
            doc = msg.media.document
            for attr in doc.attributes:
                if hasattr(attr, 'file_name'):
                    orig_name = attr.file_name
                    if '.' in orig_name:
                        ext = orig_name.split('.')[-1].lower()
                    break

        filename = f"upload-{ts}.{ext}"
        filepath = UPLOAD_DIR / filename
        await self.client.download_media(msg, filepath)

        # Get file size for quality tracking
        file_size = filepath.stat().st_size
        file_size_kb = file_size / 1024
        file_size_mb = file_size_kb / 1024

        # Get image dimensions
        try:
            with Image.open(filepath) as img:
                width, height = img.size
                dimensions = f"{width}x{height}"
        except:
            dimensions = "unknown"

        media_type = "document (full res)" if is_document else "photo (compressed)"
        print(f"  Downloaded: {filepath}")
        print(f"  Type: {media_type} | Size: {file_size_mb:.2f}MB | Dims: {dimensions}")

        # Extract EXIF metadata
        exif = extract_exif(filepath)

        # Add file metadata to exif dict for tracking
        exif["file_size_bytes"] = file_size
        exif["dimensions"] = dimensions
        exif["sent_as_document"] = is_document

        if exif["has_exif"]:
            exif_info = []
            if exif["timestamp"]:
                exif_info.append(f"taken {exif['timestamp']}")
            if exif["gps"]:
                exif_info.append(f"GPS: {exif['gps']['lat']:.4f}, {exif['gps']['lon']:.4f}")
            if exif["device_id"]:
                exif_info.append(f"device: {exif['device_id'][:30]}")
            if exif_info:
                print(f"  EXIF: {', '.join(exif_info)}")
        else:
            print(f"  EXIF: None (stripped by Telegram)")

        # DISCUSSION MODE: User wants to talk about this image, not just save it
        if wants_discussion:
            # Queue image for discussion (don't save to vehicle yet)
            self.state.discussion_images.append({
                "path": str(filepath),
                "filename": filename,
                "timestamp": ts,
                "exif": exif,
                "dimensions": dimensions
            })
            self.state.save()

            if not self.state.current_vehicle:
                # Need to know which vehicle we're discussing
                await self.reply(
                    f"📷 Got the image for discussion! ({file_size_mb:.1f}MB, {dimensions})\n\n"
                    f"Which vehicle is this? Tell me year/make/model, then ask your question."
                )
                self.state.awaiting = "vehicle_select"
            else:
                # Vehicle is set - start the discussion immediately
                print(f"  💬 Starting discussion about image...")
                await self.handle_discussion(accompanying_text)
            return

        # SAVE MODE: If vehicle is set, upload immediately (no confirmation needed)
        if self.state.current_vehicle:
            url = await self.upload_to_supabase(filepath, self.state.current_vehicle, exif)
            if url:
                print(f"  ✓ Saved to {self.state.vehicle_title}")

                # Warn about missing EXIF if sent as compressed photo
                if is_photo and not exif["has_exif"]:
                    # Only warn occasionally to avoid spam (track in state)
                    if not hasattr(self.state, '_exif_warned') or not self.state._exif_warned:
                        self.state._exif_warned = True
                        await self.reply(
                            f"📷 Saved! But no EXIF data (Telegram compressed it).\n\n"
                            f"**Tip:** Send as FILE (not photo) to preserve:\n"
                            f"• Original resolution\n"
                            f"• Timestamp when taken\n"
                            f"• GPS location\n"
                            f"• Camera/device ID\n\n"
                            f"📎 Long-press → Send as File"
                        )
            else:
                print(f"  ✗ Upload failed")
        else:
            # No vehicle set - queue it and ask
            self.state.pending_images.append({
                "path": str(filepath),
                "filename": filename,
                "timestamp": ts,
                "exif": exif
            })
            self.state.save()

            exif_warning = ""
            if is_photo and not exif["has_exif"]:
                exif_warning = "\n\n⚠️ No EXIF data. Send as FILE next time to preserve metadata."

            await self.reply(
                f"📷 Got the image! ({file_size_mb:.1f}MB, {dimensions}){exif_warning}\n\n"
                f"Which vehicle is this for? Tell me the year/make/model."
            )
            self.state.awaiting = "vehicle_select"

    async def grab_recent_images(self, count: int = 10):
        """Grab recent images from channel history and save them."""
        if not self.state.current_vehicle:
            await self.reply("Set a vehicle first, then say 'grab last X images'")
            return

        await self.reply(f"Looking for images in last {count} messages...")

        # Get recent messages from channel
        messages = await self.client.get_messages(CHANNEL_ID, limit=count + 20)

        saved = 0
        with_exif = 0
        docs = 0
        for msg in messages:
            # Skip bot's own messages
            if msg.sender_id == self.me.id:
                continue

            # Check for image
            if msg.media and isinstance(msg.media, (MessageMediaPhoto, MessageMediaDocument)):
                is_document = isinstance(msg.media, MessageMediaDocument)
                ts = datetime.now().strftime("%Y%m%d-%H%M%S") + f"-{msg.id}"

                # Get extension for documents
                ext = "jpg"
                if is_document and hasattr(msg.media, 'document'):
                    for attr in msg.media.document.attributes:
                        if hasattr(attr, 'file_name'):
                            orig_name = attr.file_name
                            if '.' in orig_name:
                                ext = orig_name.split('.')[-1].lower()
                            break

                filename = f"catchup-{ts}.{ext}"
                filepath = UPLOAD_DIR / filename

                try:
                    await self.client.download_media(msg, filepath)

                    # Get file metadata
                    file_size = filepath.stat().st_size
                    try:
                        with Image.open(filepath) as img:
                            dimensions = f"{img.size[0]}x{img.size[1]}"
                    except:
                        dimensions = "unknown"

                    exif = extract_exif(filepath)
                    exif["file_size_bytes"] = file_size
                    exif["dimensions"] = dimensions
                    exif["sent_as_document"] = is_document

                    url = await self.upload_to_supabase(filepath, self.state.current_vehicle, exif)
                    if url:
                        saved += 1
                        if exif.get("has_exif"):
                            with_exif += 1
                        if is_document:
                            docs += 1
                        print(f"  ✓ Grabbed msg {msg.id} ({dimensions}, {'doc' if is_document else 'photo'})")
                except Exception as e:
                    print(f"  ✗ Failed msg {msg.id}: {e}")

                if saved >= count:
                    break

        if saved > 0:
            stats = []
            if docs > 0:
                stats.append(f"{docs} full-res docs")
            if with_exif > 0:
                stats.append(f"{with_exif} with EXIF")
            stats_str = f" ({', '.join(stats)})" if stats else ""

            await self.reply(f"✓ Grabbed {saved} image{'s' if saved != 1 else ''}{stats_str} → **{self.state.vehicle_title}**")
        else:
            await self.reply("No images found in recent messages.")

    async def save_pending_images(self):
        """Save all pending images."""
        if not self.state.pending_images or not self.state.current_vehicle:
            await self.reply("Nothing to save.")
            return

        saved = 0
        exif_count = 0
        gps_count = 0
        for img in self.state.pending_images:
            filepath = Path(img["path"])
            if filepath.exists():
                exif = img.get("exif", {})
                url = await self.upload_to_supabase(filepath, self.state.current_vehicle, exif)
                if url:
                    saved += 1
                    if exif.get("has_exif"):
                        exif_count += 1
                    if exif.get("gps"):
                        gps_count += 1

        self.state.pending_images = []
        self.state.awaiting = None

        # Build response with EXIF summary
        response = f"✓ Saved {saved} image{'s' if saved != 1 else ''} to **{self.state.vehicle_title}**"
        if exif_count > 0:
            response += f"\n📷 {exif_count} with EXIF data"
        if gps_count > 0:
            response += f" • {gps_count} with GPS"
        response += "\n\nSend more images or tell me if you're switching vehicles."

        await self.reply(response)

    async def reply(self, text: str):
        """Send a reply to the channel."""
        await self.client.send_message(CHANNEL_ID, text)

    async def search_vehicles(self, query: str) -> List[Dict]:
        """Search for vehicles - tries VIN first, then text search."""
        if not SUPABASE_URL or not SUPABASE_KEY:
            return []

        query = query.strip()

        # 1. Try direct VIN lookup first (if query looks like a VIN)
        if len(query) >= 6 and query.replace(' ', '').isalnum():
            vin_query = query.upper().replace(' ', '')
            try:
                vin_url = f"{SUPABASE_URL}/rest/v1/vehicles?select=id,vin,year,make,model&vin=ilike.*{vin_query}*"
                req = urllib.request.Request(vin_url)
                req.add_header('Authorization', f'Bearer {SUPABASE_KEY}')
                req.add_header('apikey', SUPABASE_KEY)

                with urllib.request.urlopen(req, timeout=10) as resp:
                    vehicles = json.loads(resp.read().decode())
                    if vehicles:
                        print(f"  Found {len(vehicles)} by VIN")
                        return [
                            {
                                "id": v.get("id"),
                                "vin": v.get("vin"),
                                "title": f"{v.get('year', '')} {v.get('make', '')} {v.get('model', '')}".strip() or f"VIN: {v.get('vin')}"
                            }
                            for v in vehicles
                        ]
            except Exception as e:
                print(f"  VIN lookup error: {e}")

        # 2. Fall back to universal search
        try:
            url = f"{SUPABASE_URL}/functions/v1/universal-search"
            data = json.dumps({"query": query, "limit": 5}).encode()

            req = urllib.request.Request(url, data=data, method='POST')
            req.add_header('Authorization', f'Bearer {SUPABASE_KEY}')
            req.add_header('Content-Type', 'application/json')

            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read().decode())

            vehicles = result.get("vehicles", [])
            return [
                {
                    "id": v.get("id"),
                    "title": v.get("title") or f"{v.get('year', '')} {v.get('make', '')} {v.get('model', '')}".strip()
                }
                for v in vehicles
            ]
        except Exception as e:
            print(f"  Search error: {e}")
            return []

    async def parse_vehicle_selection(self, text: str) -> Optional[Dict]:
        """Parse vehicle selection."""
        lower = text.lower().strip()

        if lower.isdigit():
            idx = int(lower) - 1
            if 0 <= idx < len(self.state.last_search_results):
                return self.state.last_search_results[idx]

        for v in self.state.last_search_results:
            if lower in v["title"].lower():
                return v

        results = await self.search_vehicles(text)
        if len(results) == 1:
            return results[0]

        return None

    def format_search_results(self, results: List[Dict]) -> str:
        """Format search results."""
        if not results:
            return "No vehicles found."

        lines = ["**Found:**\n"]
        for i, v in enumerate(results, 1):
            lines.append(f"{i}. {v['title']}")
        lines.append("\nReply with a number to select.")
        return "\n".join(lines)

    async def upload_to_supabase(self, filepath: Path, vehicle_id: str, exif: Dict = None) -> Optional[str]:
        """Upload image to Supabase."""
        try:
            with open(filepath, 'rb') as f:
                file_data = f.read()

            filename = f"telegram/{vehicle_id}/{filepath.name}"
            storage_url = f"{SUPABASE_URL}/storage/v1/object/vehicle-images/{filename}"

            req = urllib.request.Request(storage_url, data=file_data, method='POST')
            req.add_header('Authorization', f'Bearer {SUPABASE_KEY}')
            req.add_header('Content-Type', 'image/jpeg')

            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status in (200, 201):
                    public_url = f"{SUPABASE_URL}/storage/v1/object/public/vehicle-images/{filename}"
                    self.link_image(vehicle_id, public_url, exif)
                    return public_url

        except Exception as e:
            print(f"  Upload error: {e}")
        return None

    def link_image(self, vehicle_id: str, url: str, exif: Dict = None):
        """Link image to vehicle with EXIF metadata."""
        try:
            api_url = f"{SUPABASE_URL}/rest/v1/vehicle_images"

            record = {
                "vehicle_id": vehicle_id,
                "image_url": url,
                "source": "external_import",
                "source_url": "telegram"
            }

            # Always store exif_data if we have any metadata (even file size/dimensions)
            if exif:
                record["exif_data"] = exif

                # Parse timestamp if available (format: "2024:01:15 14:30:00")
                if exif.get("timestamp"):
                    try:
                        dt = datetime.strptime(exif["timestamp"], "%Y:%m:%d %H:%M:%S")
                        record["taken_at"] = dt.isoformat() + "Z"
                    except:
                        pass

                # Store device_id for user-device association tracking
                if exif.get("device_id"):
                    # This helps us associate devices with users over time
                    # Format: "serial:ABC123" or "fingerprint:Apple|iPhone 15 Pro|17.2"
                    record["exif_data"]["device_id"] = exif["device_id"]

            data = json.dumps(record).encode()

            req = urllib.request.Request(api_url, data=data, method='POST')
            req.add_header('Authorization', f'Bearer {SUPABASE_KEY}')
            req.add_header('Content-Type', 'application/json')
            req.add_header('apikey', SUPABASE_KEY)

            urllib.request.urlopen(req, timeout=10)
        except Exception as e:
            print(f"  Link error: {e}")

    def log_discussion(self, question: str, response: str, result: Dict):
        """Log discussion to file and optionally to database."""
        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "vehicle_id": self.state.current_vehicle,
            "vehicle_title": self.state.vehicle_title,
            "question": question,
            "response": response[:500],  # Truncate for log
            "images_discussed": len(self.state.discussion_images),
            "has_estimate": bool(result.get("ui", {}).get("cards")),
        }

        # Log to file
        log_file = AGENT_DIR / "discussion_log.jsonl"
        try:
            with open(log_file, "a") as f:
                f.write(json.dumps(log_entry) + "\n")
        except Exception as e:
            print(f"  Log write error: {e}")

        # Also log as observation to database (async, best-effort)
        try:
            self._log_observation_to_db(log_entry, result)
        except Exception as e:
            print(f"  DB log error: {e}")

    def _log_observation_to_db(self, log_entry: Dict, result: Dict):
        """Log the discussion as a vehicle observation."""
        if not self.state.current_vehicle:
            return

        try:
            # Create observation record
            observation = {
                "vehicle_id": self.state.current_vehicle,
                "kind": "work_record",
                "observed_at": log_entry["timestamp"],
                "structured_data": {
                    "source": "telegram_discussion",
                    "question": log_entry["question"],
                    "ai_response": log_entry["response"],
                    "images_count": log_entry["images_discussed"],
                    "ui_data": result.get("ui")
                },
                "confidence_score": 0.7
            }

            url = f"{SUPABASE_URL}/rest/v1/vehicle_observations"
            data = json.dumps(observation).encode()

            req = urllib.request.Request(url, data=data, method='POST')
            req.add_header('Authorization', f'Bearer {SUPABASE_KEY}')
            req.add_header('Content-Type', 'application/json')
            req.add_header('apikey', SUPABASE_KEY)
            req.add_header('Prefer', 'return=minimal')

            urllib.request.urlopen(req, timeout=10)
            print(f"  📝 Logged observation to DB")
        except Exception as e:
            print(f"  Observation log error: {e}")


async def main():
    bot = NukeBot()
    await bot.start()


if __name__ == "__main__":
    asyncio.run(main())
