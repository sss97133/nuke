#!/usr/bin/env python3
"""
Universal Email Intelligence Extraction Tool
One pass across ~101GB of MBOX + .emlx data -> SQLite database with 5 tables.
"""

import os
import sys
import re
import json
import hashlib
import sqlite3
import time
import math
import email
import email.utils
import email.header
from datetime import datetime, timedelta
from collections import defaultdict, Counter
from pathlib import Path

# Force unbuffered output
sys.stdout = os.fdopen(sys.stdout.fileno(), 'w', buffering=1)

HOME = os.path.expanduser("~")
DB_PATH = os.path.join(HOME, "email_intelligence.db")

# ── DATA SOURCES ──────────────────────────────────────────────────────────────

MBOX_SOURCES = [
    ("jenny_tpo_email_archive/inbox.mbox", "jenny_tpo", "inbox"),
    ("jenny_tpo_email_archive/sent_messages.mbox", "jenny_tpo", "sent"),
    ("jenny_tpo_email_archive/archive.mbox", "jenny_tpo", "archive"),
    ("jenny_tpo_email_archive/drafts.mbox", "jenny_tpo", "draft"),
    ("philippe_tpo_email_archive/inbox.mbox", "philippe_tpo", "inbox"),
    ("philippe_tpo_email_archive/sent_messages.mbox", "philippe_tpo", "sent"),
    ("philippe_tpo_email_archive/archive.mbox", "philippe_tpo", "archive"),
    ("philippe_tpo_email_archive/drafts.mbox", "philippe_tpo", "draft"),
    ("ionos_email_archive/ionos_archive.mbox", "ionos", "archive"),
    ("ionos_email_archive/ionos_sent_and_others.mbox", "ionos", "sent"),
    ("JENNY EMAILS ASB/artsaintbarth_email_archive/inbox.mbox", "jenny_asb", "inbox"),
    ("JENNY EMAILS ASB/artsaintbarth_email_archive/sent.mbox", "jenny_asb", "sent"),
    ("JENNY EMAILS ASB/artsaintbarth_email_archive/drafts.mbox", "jenny_asb", "draft"),
    ("PHIL EMAILS ASB/phil_email_archive/inbox.mbox", "phil_asb", "inbox"),
    ("PHIL EMAILS ASB/phil_email_archive/sent.mbox", "phil_asb", "sent"),
    ("PHIL EMAILS ASB/phil_email_archive/archive.mbox", "phil_asb", "archive"),
    ("PHIL EMAILS ASB/phil_email_archive/drafts.mbox", "phil_asb", "draft"),
    ("PHIL EMAILS ASB/phil_email_archive/restored_drafts.mbox", "phil_asb", "draft"),
]

EMLX_DIRS = [
    "Library/Mail/V10/38A90DB5-9BC2-4347-B4DA-18398A5C5ACC",
    "Library/Mail/V10/3A040BB8-B7EF-48AA-9937-0DD33DFB6294",
    "Library/Mail/V10/43C025A9-B799-48D7-99D1-E9E77D7DB27E",
    "Library/Mail/V10/801B7B58-0CDD-4112-A4FE-3F05512F8A4D",
    "Library/Mail/V10/B935210B-B632-4C65-B609-3583A75A2FA8",
    "Library/Mail/V10/C4BA49C1-B6BA-47EE-A1C5-20C8566AC5F4",
    "Library/Mail/V10/D05E615B-7BAF-4CDC-AA5D-AC05A2023DBF",
    "Library/Mail/V10/DA365638-DDDC-4440-B11B-3D62C2A93C5A",
    "Library/Mail/V10/F4E37206-1941-4E98-9527-3CE8CC7743E2",
]

# Comma-separated list of the archive owners' own addresses (kept out of the
# repo — these identify real mailboxes)
OPERATOR_EMAILS = {
    a.strip().lower()
    for a in os.environ.get("PUBLISHING_OPERATOR_EMAILS", "").split(",")
    if a.strip()
}

# ── REGEX PATTERNS (compiled once) ───────────────────────────────────────────

RE_HTML = re.compile(r'<[^>]+>')
RE_MULTI_SPACE = re.compile(r'\s+')
RE_REPLY = re.compile(r'^(Re|Fwd|Fw|Tr|Rép)\s*:\s*', re.IGNORECASE)
RE_ENCODING = re.compile(r'=\?[^?]+\?[BQ]\?[^?]*\?=', re.IGNORECASE)

FR_WORDS = set("le la les de du des pour avec dans sur est nous votre bonjour merci objet réponse envoyé un une et en qui que ce au".split())
EN_WORDS = set("the and for with from your this that dear regards please thanks is are have has been will would can could".split())

PRODUCTION_PATTERNS = {
    "planning": re.compile(r'planning|lineup|sommaire|sujet|brief|concept|calendrier', re.I),
    "photography": re.compile(r'shoot|photo|séance|studio|photographe|lookbook', re.I),
    "editorial": re.compile(r'article|texte|copy|rédaction|relecture|correction|interview', re.I),
    "design": re.compile(r'maquette|layout|mise.en.page|design|graphi|couverture|cover', re.I),
    "prepress": re.compile(r'BAT|bon.à.tirer|épreuve|proof|prépresse', re.I),
    "print": re.compile(r'imprim|print|tirage|impression|bouclage', re.I),
    "advertising": re.compile(r'pub|publicité|annonceur|ad\b|insertion|booking|média.kit', re.I),
    "distribution": re.compile(r'distribu|diffusion|envoi|livraison|kiosque|abonné|launch|parution', re.I),
}

RE_FINANCIAL = re.compile(r'(?:€|EUR|USD|\$|£|GBP|CHF)\s*[\d,.]+|[\d,.]+\s*(?:€|EUR|USD|\$|£|GBP|CHF)|facture|invoice|devis|quote|bon.de.commande', re.I)
RE_FINANCIAL_AMOUNTS = re.compile(r'(?:(€|EUR|USD|\$|£|GBP|CHF)\s*([\d,.]+)|([\d,.]+)\s*(€|EUR|USD|\$|£|GBP|CHF))', re.I)
RE_URGENCY = re.compile(r'urgent|asap|deadline|date.limite|retard|delay|rappel|reminder|impératif', re.I)
RE_ATTACHMENT = re.compile(r'pdf|jpeg|jpg|png|tiff|indd|psd|wetransfer|dropbox|google.drive|hightail', re.I)
RE_ISSUE = re.compile(r'issue|n°|numéro|#\d+|SS\d{2}|FW\d{2}|PE\d{2}|AH\d{2}|(?:spring|summer|autumn|winter|printemps|été|automne|hiver)\s*\d{2,4}', re.I)
RE_EVENT = re.compile(r'vernissage|opening|lancement|launch|inaugur|RSVP|invitation|gala|soirée|cocktail|exposition', re.I)
RE_PREFERENCE_SUBJ = re.compile(r'prefer|préfér|would.like|souhaiter|as.usual|comme.d.habitude|always|toujours|never|jamais|please.ensure|veuillez', re.I)

RE_FORMAL = re.compile(r'\b(?:Cher|Chère|Monsieur|Madame|Dear|Cordialement|Bien\s+à\s+vous|Veuillez|vous)\b', re.I)
RE_INFORMAL = re.compile(r'\b(?:Salut|Coucou|Hey|Hi\b|Bisous|Bises|tu\b|ça)\b', re.I)

RE_POSITIVE = re.compile(r'merci|thank|excellent|parfait|perfect|great|super|génial|formidable|bravo|félicitation|happy|pleased|ravi', re.I)
RE_NEGATIVE = re.compile(r'problème|problem|issue|concern|désolé|sorry|unfortunately|malheureusement|disappointed|déçu|retard|delay|erreur|error', re.I)

RE_ACTION = re.compile(r'[^.!?\n]*(?:please.+(?:send|confirm|review|check|approve|sign)|merci.de|veuillez|pourriez-vous|could.you|can.you.+(?:send|confirm))[^.!?\n]*[.!?]?', re.I)
RE_PREF_BODY = re.compile(r'[^.!?\n]*(?:I.prefer|we.prefer|je.préfère|nous.préférons|I.would.like|je.souhaite|as.usual|comme.d.habitude|please.ensure|please.always|toujours\s+\w|never\s+\w|jamais\s+\w)[^.!?\n]*[.!?]?', re.I)

CURRENCY_MAP = {"$": "USD", "€": "EUR", "£": "GBP"}

# ── DATABASE SETUP ────────────────────────────────────────────────────────────

def create_database():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA cache_size=-200000")  # 200MB cache
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("""
    CREATE TABLE email_observations (
        content_hash TEXT PRIMARY KEY,
        message_id TEXT,
        in_reply_to TEXT,
        "references" TEXT,
        date TEXT,
        date_day_of_week INTEGER,
        date_hour INTEGER,
        from_email TEXT,
        from_name TEXT,
        from_domain TEXT,
        to_emails TEXT,
        to_names TEXT,
        cc_emails TEXT,
        cc_names TEXT,
        recipient_count INTEGER,
        subject TEXT,
        subject_clean TEXT,
        is_reply INTEGER,
        is_forward INTEGER,
        thread_subject TEXT,
        source_mailbox TEXT,
        source_account TEXT,
        source_direction TEXT,
        language TEXT,
        production_phases TEXT,
        has_financial_signal INTEGER,
        financial_amounts TEXT,
        has_urgency INTEGER,
        has_attachment_signal INTEGER,
        issue_references TEXT,
        event_signals TEXT,
        has_preference_signal INTEGER,
        body_preview TEXT,
        body_language TEXT,
        formality_score REAL,
        sentiment TEXT,
        action_items TEXT,
        preference_statements TEXT
    )
    """)
    conn.execute("""
    CREATE TABLE threads (
        thread_id TEXT PRIMARY KEY,
        subject TEXT,
        first_date TEXT,
        last_date TEXT,
        message_count INTEGER,
        participant_count INTEGER,
        participants TEXT,
        max_depth INTEGER,
        avg_reply_latency_hours REAL,
        initiator_email TEXT,
        production_phases TEXT,
        has_financial INTEGER,
        has_resolution INTEGER
    )
    """)
    conn.execute("""
    CREATE TABLE person_profiles (
        email TEXT PRIMARY KEY,
        name TEXT,
        domain TEXT,
        is_operator INTEGER,
        total_sent INTEGER,
        total_received INTEGER,
        total_cc INTEGER,
        unique_correspondents INTEGER,
        first_seen TEXT,
        last_seen TEXT,
        active_months INTEGER,
        peak_activity_day INTEGER,
        peak_activity_hour INTEGER,
        preferred_language TEXT,
        avg_formality REAL,
        avg_response_time_hours REAL,
        median_response_time_hours REAL,
        initiator_ratio REAL,
        cc_ratio REAL,
        activity_density REAL,
        activity_pattern TEXT,
        relationship_phase TEXT,
        attachment_rate REAL,
        financial_rate REAL,
        production_phases TEXT,
        thread_count INTEGER,
        avg_thread_depth REAL,
        stated_preferences TEXT,
        relationship_warmth REAL,
        trajectory TEXT,
        source_accounts TEXT
    )
    """)
    conn.execute("""
    CREATE TABLE org_profiles (
        domain TEXT PRIMARY KEY,
        inferred_name TEXT,
        country TEXT,
        contact_count INTEGER,
        total_emails INTEGER,
        first_seen TEXT,
        last_seen TEXT,
        active_months INTEGER,
        avg_response_time_hours REAL,
        seasonal_peak_month INTEGER,
        financial_signal_count INTEGER,
        thread_count INTEGER,
        relationship_health REAL,
        primary_operator TEXT,
        source_accounts TEXT
    )
    """)
    conn.execute("""
    CREATE TABLE relationship_edges (
        source_email TEXT,
        target_email TEXT,
        weight INTEGER,
        type TEXT,
        first_date TEXT,
        last_date TEXT,
        is_reciprocal INTEGER,
        avg_interval_days REAL,
        PRIMARY KEY (source_email, target_email, type)
    )
    """)
    conn.commit()
    return conn

# ── HEADER / SIGNAL EXTRACTION ────────────────────────────────────────────────

def decode_header(raw):
    if not raw:
        return ""
    try:
        parts = email.header.decode_header(raw)
        decoded = []
        for data, charset in parts:
            if isinstance(data, bytes):
                decoded.append(data.decode(charset or 'utf-8', errors='replace'))
            else:
                decoded.append(data)
        return ' '.join(decoded)
    except Exception:
        if isinstance(raw, bytes):
            return raw.decode('utf-8', errors='replace')
        return str(raw)

def parse_address(raw):
    if not raw:
        return "", ""
    try:
        name, addr = email.utils.parseaddr(decode_header(raw))
        return name.strip(), addr.strip().lower()
    except Exception:
        return "", raw.strip().lower() if raw else ""

def parse_address_list(raw):
    if not raw:
        return [], []
    try:
        decoded = decode_header(raw)
        pairs = email.utils.getaddresses([decoded])
        names = [n.strip() for n, a in pairs]
        emails = [a.strip().lower() for n, a in pairs if a.strip()]
        return emails, names
    except Exception:
        return [], []

def parse_date(raw):
    if not raw:
        return None, None, None
    try:
        decoded = decode_header(raw)
        parsed = email.utils.parsedate_to_datetime(decoded)
        iso = parsed.strftime('%Y-%m-%dT%H:%M:%S')
        return iso, parsed.weekday(), parsed.hour
    except Exception:
        return None, None, None

def detect_language(text):
    if not text:
        return "en"
    words = re.findall(r'[a-zàâäéèêëïîôùûüÿçœæ]+', text.lower())
    if not words:
        return "en"
    fr_count = sum(1 for w in words if w in FR_WORDS)
    en_count = sum(1 for w in words if w in EN_WORDS)
    total = fr_count + en_count
    if total == 0:
        return "en"
    if fr_count / total > 0.6:
        return "fr"
    if en_count / total > 0.6:
        return "en"
    return "mixed"

def clean_subject(subj):
    if not subj:
        return "", "", False, False
    s = decode_header(subj)
    is_reply = bool(re.match(r'^(Re|Rép|Tr)\s*:', s, re.I))
    is_forward = bool(re.match(r'^(Fwd|Fw)\s*:', s, re.I))
    clean = RE_REPLY.sub('', s).strip()
    while RE_REPLY.match(clean):
        clean = RE_REPLY.sub('', clean).strip()
    thread_subj = clean
    return s, clean, is_reply, is_forward, thread_subj

def extract_financial_amounts(text):
    amounts = []
    for m in RE_FINANCIAL_AMOUNTS.finditer(text):
        if m.group(1):
            cur = CURRENCY_MAP.get(m.group(1), m.group(1).upper())
            amounts.append({"amount": m.group(2).replace(',', ''), "currency": cur})
        elif m.group(4):
            cur = CURRENCY_MAP.get(m.group(4), m.group(4).upper())
            amounts.append({"amount": m.group(3).replace(',', ''), "currency": cur})
    return amounts

def extract_subject_signals(subj):
    if not subj:
        return {
            "language": "en", "production_phases": [], "has_financial_signal": False,
            "financial_amounts": [], "has_urgency": False, "has_attachment_signal": False,
            "issue_references": [], "event_signals": [], "has_preference_signal": False,
        }
    phases = [p for p, rx in PRODUCTION_PATTERNS.items() if rx.search(subj)]
    fin_amounts = extract_financial_amounts(subj)
    issues = [m.group() for m in RE_ISSUE.finditer(subj)]
    events = [m.group() for m in RE_EVENT.finditer(subj)]
    return {
        "language": detect_language(subj),
        "production_phases": phases,
        "has_financial_signal": bool(RE_FINANCIAL.search(subj)),
        "financial_amounts": fin_amounts,
        "has_urgency": bool(RE_URGENCY.search(subj)),
        "has_attachment_signal": bool(RE_ATTACHMENT.search(subj)),
        "issue_references": issues,
        "event_signals": events,
        "has_preference_signal": bool(RE_PREFERENCE_SUBJ.search(subj)),
    }

def extract_body_signals(body):
    if not body or not body.strip():
        return {
            "body_preview": "", "body_language": "en", "formality_score": 0.5,
            "sentiment": "neutral", "action_items": [], "preference_statements": [],
        }
    # Strip HTML
    text = RE_HTML.sub(' ', body)
    text = RE_MULTI_SPACE.sub(' ', text).strip()
    preview = text[:500]

    lang = detect_language(preview)
    formal_count = len(RE_FORMAL.findall(preview))
    informal_count = len(RE_INFORMAL.findall(preview))
    formality = formal_count / (formal_count + informal_count + 1)

    pos = len(RE_POSITIVE.findall(preview))
    neg = len(RE_NEGATIVE.findall(preview))
    net = pos - neg
    sentiment = "positive" if net > 0 else ("negative" if net < 0 else "neutral")

    actions = [m.group().strip() for m in RE_ACTION.finditer(preview)][:3]
    prefs = [m.group().strip() for m in RE_PREF_BODY.finditer(preview)][:3]

    return {
        "body_preview": preview,
        "body_language": lang,
        "formality_score": round(formality, 3),
        "sentiment": sentiment,
        "action_items": actions,
        "preference_statements": prefs,
    }

def compute_hash(from_email, date, subject):
    raw = f"{from_email or ''}|{date or ''}|{subject or ''}"
    return hashlib.sha256(raw.encode('utf-8', errors='replace')).hexdigest()[:32]

# ── MBOX STREAMING PARSER ────────────────────────────────────────────────────

FROM_LINE = re.compile(r'^From .+ \d{4}$|^From .+ [+-]\d{4}$|^From \S+\s+\w{3}\s+\w{3}\s+\d')

def process_message_lines(header_lines, body_chars, source_mailbox, source_account, source_direction):
    """Parse header lines + body chars into an observation dict."""
    # Build headers dict with continuation handling
    headers = {}
    current_key = None
    current_val = None
    for line in header_lines:
        if line and line[0] in (' ', '\t'):
            if current_key:
                current_val += ' ' + line.strip()
                headers[current_key] = current_val
        else:
            idx = line.find(':')
            if idx > 0:
                current_key = line[:idx].strip().lower()
                current_val = line[idx+1:].strip()
                headers[current_key] = current_val
            else:
                current_key = None

    from_name, from_email_addr = parse_address(headers.get('from', ''))
    to_emails, to_names = parse_address_list(headers.get('to', ''))
    cc_emails, cc_names = parse_address_list(headers.get('cc', ''))
    date_iso, day_of_week, hour = parse_date(headers.get('date', ''))
    raw_subject = headers.get('subject', '')
    subj_decoded, subj_clean, is_reply, is_fwd, thread_subj = clean_subject(raw_subject)
    msg_id = decode_header(headers.get('message-id', '')).strip('<> ')
    in_reply = decode_header(headers.get('in-reply-to', '')).strip('<> ')
    refs = decode_header(headers.get('references', ''))

    subj_signals = extract_subject_signals(subj_decoded)
    body_signals = extract_body_signals(body_chars)

    from_domain = from_email_addr.split('@')[-1] if '@' in from_email_addr else ''
    chash = compute_hash(from_email_addr, date_iso, subj_decoded)

    return (
        chash, msg_id, in_reply, refs, date_iso, day_of_week, hour,
        from_email_addr, from_name, from_domain,
        json.dumps(to_emails), json.dumps(to_names),
        json.dumps(cc_emails), json.dumps(cc_names),
        len(to_emails) + len(cc_emails),
        subj_decoded, subj_clean, int(is_reply), int(is_fwd), thread_subj,
        source_mailbox, source_account, source_direction,
        subj_signals["language"],
        json.dumps(subj_signals["production_phases"]),
        int(subj_signals["has_financial_signal"]),
        json.dumps(subj_signals["financial_amounts"]),
        int(subj_signals["has_urgency"]),
        int(subj_signals["has_attachment_signal"]),
        json.dumps(subj_signals["issue_references"]),
        json.dumps(subj_signals["event_signals"]),
        int(subj_signals["has_preference_signal"]),
        body_signals["body_preview"],
        body_signals["body_language"],
        body_signals["formality_score"],
        body_signals["sentiment"],
        json.dumps(body_signals["action_items"]),
        json.dumps(body_signals["preference_statements"]),
    )

INSERT_SQL = """INSERT OR IGNORE INTO email_observations VALUES (
    ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
)"""

FROM_BOUNDARY = b'\nFrom '

def stream_mbox(filepath, source_account, source_direction, conn):
    """Stream an MBOX file using binary chunk reading for speed.

    Key optimization: after reading headers + 500 chars of body, we seek
    forward to find the next 'From ' boundary instead of reading every line.
    """
    if not os.path.exists(filepath):
        print(f"  WARNING: {filepath} not found, skipping")
        return 0

    filesize = os.path.getsize(filepath)
    print(f"  Processing {filepath} ({filesize / (1024**3):.1f}GB)")

    count = 0
    batch = []
    mailbox_name = os.path.basename(filepath)

    # Read file in binary and split on \nFrom boundaries
    CHUNK = 256 * 1024  # 256KB read-ahead for boundary search

    with open(filepath, 'rb') as f:
        # Skip to first "From " line
        first_line = f.readline()
        if not first_line.startswith(b'From '):
            f.seek(0)
            # Search for first From in file
            chunk = f.read(CHUNK)
            idx = chunk.find(b'From ')
            if idx < 0:
                print(f"    WARNING: No From lines found in {filepath}")
                return 0
            f.seek(idx)

        while True:
            pos = f.tell()
            if pos >= filesize:
                break

            # Read enough for headers + body preview (typically < 64KB for headers)
            # We read up to 128KB which covers virtually all header sections + 500 chars body
            raw = f.read(128 * 1024)
            if not raw:
                break

            # Find the end of headers (blank line)
            header_end = raw.find(b'\r\n\r\n')
            alt_end = raw.find(b'\n\n')
            if header_end < 0 and alt_end < 0:
                # No blank line found in 128KB - skip this malformed message
                # Seek to next From boundary
                rest = f.read(CHUNK)
                while rest:
                    idx = rest.find(FROM_BOUNDARY)
                    if idx >= 0:
                        f.seek(f.tell() - len(rest) + idx + 1)  # +1 to position at 'From '
                        break
                    rest = f.read(CHUNK)
                continue

            if header_end >= 0 and alt_end >= 0:
                hdr_end = min(header_end, alt_end)
                sep_len = 4 if hdr_end == header_end else 2
            elif header_end >= 0:
                hdr_end = header_end
                sep_len = 4
            else:
                hdr_end = alt_end
                sep_len = 2

            header_bytes = raw[:hdr_end]
            body_start = hdr_end + sep_len
            # Get up to 2000 bytes of body (plenty for 500 chars)
            body_bytes = raw[body_start:body_start + 2000]

            # Decode headers
            try:
                header_text = header_bytes.decode('utf-8', errors='replace')
            except Exception:
                header_text = header_bytes.decode('latin-1', errors='replace')

            # Remove the "From <addr> <date>" envelope line
            lines = header_text.split('\n')
            if lines and lines[0].startswith('From '):
                lines = lines[1:]
            header_lines = [l.rstrip('\r') for l in lines]

            # Decode body preview
            try:
                body_text = body_bytes.decode('utf-8', errors='replace')
            except Exception:
                body_text = body_bytes.decode('latin-1', errors='replace')

            # Process this message
            try:
                row = process_message_lines(
                    header_lines, body_text[:500],
                    mailbox_name, source_account, source_direction
                )
                batch.append(row)
                count += 1
                if len(batch) >= 1000:
                    conn.executemany(INSERT_SQL, batch)
                    conn.commit()
                    batch = []
                if count % 2000 == 0:
                    pct = (f.tell() / filesize * 100) if filesize else 0
                    print(f"    {count:,} messages ({pct:.0f}%)...")
            except Exception:
                pass

            # Now seek to the next "From " boundary
            # We already read 128KB from pos. The next message starts at the next \nFrom
            # First check if we already have it in our read buffer
            search_start = body_start + 2000  # skip past what we've used
            if search_start < len(raw):
                idx = raw.find(FROM_BOUNDARY, search_start)
                if idx >= 0:
                    # Found it in buffer, seek to it (+1 to skip the \n)
                    f.seek(pos + idx + 1)
                    continue

            # Not in buffer, need to seek forward
            # Position file just after our read buffer
            f.seek(pos + len(raw))

            # Read chunks until we find the next boundary
            found = False
            while True:
                search_pos = f.tell()
                chunk = f.read(CHUNK)
                if not chunk:
                    break
                idx = chunk.find(FROM_BOUNDARY)
                if idx >= 0:
                    f.seek(search_pos + idx + 1)  # +1 to skip \n, position at 'From '
                    found = True
                    break
                # Keep last 5 bytes to handle boundary split across chunks
                if len(chunk) == CHUNK:
                    f.seek(f.tell() - 5)

            if not found:
                break  # end of file

    if batch:
        conn.executemany(INSERT_SQL, batch)
        conn.commit()

    print(f"    Done: {count:,} messages from {mailbox_name}")
    return count

# ── EMLX PARSER ───────────────────────────────────────────────────────────────

def infer_emlx_direction(filepath):
    fp = filepath.lower()
    if 'sent' in fp:
        return 'sent'
    if 'draft' in fp:
        return 'draft'
    if 'trash' in fp or 'junk' in fp or 'spam' in fp:
        return 'archive'
    return 'inbox'

def process_emlx_file(filepath):
    """Parse a single .emlx file."""
    try:
        with open(filepath, 'rb') as f:
            first_line = f.readline()
            # First line is byte count - skip it
            rest = f.read()

        # Find the XML plist that Apple appends - stop before it
        plist_marker = b'<?xml version='
        plist_idx = rest.rfind(plist_marker)
        if plist_idx > 0:
            msg_data = rest[:plist_idx]
        else:
            msg_data = rest

        # Parse headers and body manually (faster than email.message_from_bytes for our needs)
        header_end = msg_data.find(b'\r\n\r\n')
        if header_end == -1:
            header_end = msg_data.find(b'\n\n')
        if header_end == -1:
            return None

        header_bytes = msg_data[:header_end]
        body_start = header_end + 4 if b'\r\n\r\n' in msg_data[:header_end+4] else header_end + 2
        body_bytes = msg_data[body_start:body_start+2000]  # read enough for 500 chars

        try:
            header_text = header_bytes.decode('utf-8', errors='replace')
        except Exception:
            header_text = header_bytes.decode('latin-1', errors='replace')

        try:
            body_text = body_bytes.decode('utf-8', errors='replace')
        except Exception:
            body_text = body_bytes.decode('latin-1', errors='replace')

        header_lines = header_text.split('\n')
        # Remove any \r
        header_lines = [l.rstrip('\r') for l in header_lines]

        direction = infer_emlx_direction(filepath)
        # Infer account from path
        parts = filepath.split('/')
        account = "macmail"
        for p in parts:
            if p.startswith(('38A', '3A0', '43C', '801', 'B93', 'C4B', 'D05', 'DA3', 'F4E')):
                account = f"macmail_{p[:8]}"
                break

        return process_message_lines(
            header_lines, body_text[:500],
            os.path.basename(filepath), account, direction
        )
    except Exception as e:
        return None

def process_emlx_dirs(conn):
    """Walk all emlx directories and process .emlx files."""
    total = 0
    batch = []

    for rel_dir in EMLX_DIRS:
        dirpath = os.path.join(HOME, rel_dir)
        if not os.path.isdir(dirpath):
            print(f"  WARNING: {dirpath} not found, skipping")
            continue

        print(f"  Scanning {rel_dir}...")
        dir_count = 0

        for root, dirs, files in os.walk(dirpath):
            for fname in files:
                if not fname.endswith('.emlx'):
                    continue
                fpath = os.path.join(root, fname)
                row = process_emlx_file(fpath)
                if row:
                    batch.append(row)
                    dir_count += 1
                    total += 1

                    if len(batch) >= 1000:
                        conn.executemany(INSERT_SQL, batch)
                        conn.commit()
                        batch = []

                    if total % 5000 == 0:
                        print(f"    {total:,} emlx files processed...")

        print(f"    {dir_count:,} emails from {os.path.basename(dirpath)[:8]}...")

    if batch:
        conn.executemany(INSERT_SQL, batch)
        conn.commit()

    print(f"    Done: {total:,} total emlx emails")
    return total

# ── PHASE 2: THREAD RECONSTRUCTION ───────────────────────────────────────────

def build_threads(conn):
    print("\nPhase 2: Building threads...")
    cur = conn.cursor()

    # Index for performance
    conn.execute("CREATE INDEX IF NOT EXISTS idx_obs_msgid ON email_observations(message_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_obs_thread ON email_observations(thread_subject)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_obs_date ON email_observations(date)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_obs_from ON email_observations(from_email)")

    # Strategy: group by references chain first, then by thread_subject + time window
    # Build message_id -> thread_id mapping

    # Get all messages with references
    rows = cur.execute("""
        SELECT content_hash, message_id, in_reply_to, "references", thread_subject,
               date, from_email, to_emails, cc_emails, production_phases,
               has_financial_signal
        FROM email_observations
        ORDER BY date
    """).fetchall()

    print(f"  Processing {len(rows):,} messages for threading...")

    # Union-Find for thread grouping
    msg_to_thread = {}  # message_id -> thread_id
    thread_members = defaultdict(list)  # thread_id -> [row indices]

    # First pass: group by references
    for i, row in enumerate(rows):
        chash, msg_id, in_reply, refs, thread_subj, date, from_email, to_emails, cc_emails, phases, fin = row

        thread_id = None

        # Check references chain
        if refs:
            ref_ids = refs.replace('<', ' ').replace('>', ' ').split()
            for rid in ref_ids:
                rid = rid.strip()
                if rid in msg_to_thread:
                    thread_id = msg_to_thread[rid]
                    break

        # Check in_reply_to
        if not thread_id and in_reply and in_reply in msg_to_thread:
            thread_id = msg_to_thread[in_reply]

        if not thread_id:
            # Use thread_subject as fallback thread_id
            thread_id = f"subj:{(thread_subj or 'no_subject').lower().strip()[:100]}"

        if msg_id:
            msg_to_thread[msg_id] = thread_id
        thread_members[thread_id].append(i)

    print(f"  Found {len(thread_members):,} threads")

    # Now build thread table
    thread_batch = []
    for tid, member_indices in thread_members.items():
        if not member_indices:
            continue

        members = [rows[i] for i in member_indices]
        dates = [m[5] for m in members if m[5]]
        dates.sort()

        participants = set()
        all_phases = set()
        has_fin = False

        for m in members:
            if m[6]:
                participants.add(m[6])
            try:
                for e in json.loads(m[7]):
                    if e:
                        participants.add(e)
                for e in json.loads(m[8]):
                    if e:
                        participants.add(e)
            except Exception:
                pass
            try:
                for p in json.loads(m[9]):
                    all_phases.add(p)
            except Exception:
                pass
            if m[10]:
                has_fin = True

        initiator = members[0][6] if members else ""

        # Compute reply latencies
        latencies = []
        if len(dates) >= 2:
            for j in range(1, min(len(dates), 10)):
                try:
                    d1 = datetime.fromisoformat(dates[j-1])
                    d2 = datetime.fromisoformat(dates[j])
                    h = (d2 - d1).total_seconds() / 3600
                    if 0 < h < 720:  # ignore >30 days
                        latencies.append(h)
                except Exception:
                    pass

        avg_latency = sum(latencies) / len(latencies) if latencies else None

        thread_batch.append((
            tid,
            members[0][4] or "",  # subject
            dates[0] if dates else None,
            dates[-1] if dates else None,
            len(members),
            len(participants),
            json.dumps(list(participants)),
            len(members),  # rough depth
            avg_latency,
            initiator,
            json.dumps(list(all_phases)),
            int(has_fin),
            0  # has_resolution - would need more analysis
        ))

        if len(thread_batch) >= 1000:
            conn.executemany("INSERT OR IGNORE INTO threads VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", thread_batch)
            thread_batch = []

    if thread_batch:
        conn.executemany("INSERT OR IGNORE INTO threads VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", thread_batch)
    conn.commit()

    count = cur.execute("SELECT COUNT(*) FROM threads").fetchone()[0]
    print(f"  Threads built: {count:,}")

# ── PHASE 3: PERSON PROFILES ─────────────────────────────────────────────────

def build_person_profiles(conn):
    print("\nPhase 3: Building person profiles...")
    cur = conn.cursor()

    # Collect all unique emails
    emails_data = defaultdict(lambda: {
        "names": Counter(), "domains": Counter(), "sent": 0, "received": 0, "cc": 0,
        "correspondents": set(), "dates": [], "days": [], "hours": [],
        "languages": Counter(), "formality_scores": [], "source_accounts": set(),
        "attachment_count": 0, "financial_count": 0, "total_count": 0,
        "phases": Counter(), "preferences": [], "initiated": 0, "total_threads": 0,
    })

    # Process all emails
    batch_size = 50000
    offset = 0
    while True:
        rows = cur.execute(f"""
            SELECT from_email, from_name, from_domain, to_emails, cc_emails,
                   date, date_day_of_week, date_hour, language, formality_score,
                   source_account, has_attachment_signal, has_financial_signal,
                   production_phases, preference_statements, is_reply,
                   to_names, body_language, source_direction
            FROM email_observations
            LIMIT {batch_size} OFFSET {offset}
        """).fetchall()

        if not rows:
            break
        offset += batch_size

        for row in rows:
            (from_email, from_name, from_domain, to_emails_j, cc_emails_j,
             date, dow, hour, lang, formality, src_acct, has_attach, has_fin,
             phases_j, prefs_j, is_reply, to_names_j, body_lang, direction) = row

            if from_email:
                d = emails_data[from_email]
                d["sent"] += 1
                d["total_count"] += 1
                if from_name:
                    d["names"][from_name] += 1
                if from_domain:
                    d["domains"][from_domain] += 1
                if date:
                    d["dates"].append(date)
                if dow is not None:
                    d["days"].append(dow)
                if hour is not None:
                    d["hours"].append(hour)
                if lang:
                    d["languages"][lang] += 1
                if formality is not None:
                    d["formality_scores"].append(formality)
                if src_acct:
                    d["source_accounts"].add(src_acct)
                if has_attach:
                    d["attachment_count"] += 1
                if has_fin:
                    d["financial_count"] += 1
                if not is_reply:
                    d["initiated"] += 1
                try:
                    for p in json.loads(phases_j):
                        d["phases"][p] += 1
                except Exception:
                    pass
                try:
                    for p in json.loads(prefs_j):
                        if p:
                            d["preferences"].append(p)
                except Exception:
                    pass

            # Track recipients
            try:
                to_list = json.loads(to_emails_j) if to_emails_j else []
            except Exception:
                to_list = []
            try:
                cc_list = json.loads(cc_emails_j) if cc_emails_j else []
            except Exception:
                cc_list = []

            for e in to_list:
                if e:
                    emails_data[e]["received"] += 1
                    emails_data[e]["total_count"] += 1
                    if from_email:
                        emails_data[e]["correspondents"].add(from_email)
                        emails_data[from_email]["correspondents"].add(e)
                    if date:
                        emails_data[e]["dates"].append(date)
                    if src_acct:
                        emails_data[e]["source_accounts"].add(src_acct)

            for e in cc_list:
                if e:
                    emails_data[e]["cc"] += 1
                    emails_data[e]["total_count"] += 1
                    if date:
                        emails_data[e]["dates"].append(date)
                    if src_acct:
                        emails_data[e]["source_accounts"].add(src_acct)

    print(f"  Building profiles for {len(emails_data):,} unique email addresses...")

    now = datetime(2026, 4, 8)
    profile_batch = []

    for addr, d in emails_data.items():
        if not addr or '@' not in addr:
            continue

        name = d["names"].most_common(1)[0][0] if d["names"] else ""
        domain = d["domains"].most_common(1)[0][0] if d["domains"] else (addr.split('@')[-1] if '@' in addr else "")

        dates = sorted([x for x in d["dates"] if x])
        first_seen = dates[0] if dates else None
        last_seen = dates[-1] if dates else None

        # Active months
        months = set()
        for dt in dates:
            try:
                months.add(dt[:7])
            except Exception:
                pass
        active_months = len(months)

        # Peak day/hour
        peak_day = Counter(d["days"]).most_common(1)[0][0] if d["days"] else 0
        peak_hour = Counter(d["hours"]).most_common(1)[0][0] if d["hours"] else 0

        pref_lang = d["languages"].most_common(1)[0][0] if d["languages"] else "en"
        avg_form = sum(d["formality_scores"]) / len(d["formality_scores"]) if d["formality_scores"] else 0.5

        total = d["total_count"] or 1
        initiator_ratio = d["initiated"] / total if total else 0
        cc_ratio = d["cc"] / total if total else 0
        attach_rate = d["attachment_count"] / total
        fin_rate = d["financial_count"] / total

        # Activity density (emails per month)
        if active_months > 0:
            density = total / active_months
        else:
            density = 0

        # Activity pattern
        if active_months >= 12 and density >= 2:
            pattern = "sustained"
        elif active_months >= 3:
            pattern = "burst"
        elif active_months >= 2:
            pattern = "occasional"
        else:
            pattern = "one_shot"

        # Relationship phase
        if last_seen:
            try:
                ls = datetime.fromisoformat(last_seen)
                months_ago = (now - ls).days / 30
                if months_ago < 3:
                    if active_months < 3:
                        phase = "new"
                    else:
                        phase = "sustained"
                elif months_ago < 12:
                    phase = "fading" if active_months > 3 else "growing"
                else:
                    phase = "dormant"
            except Exception:
                phase = "dormant"
        else:
            phase = "dormant"

        # Warmth
        total_emails = d["sent"] + d["received"]
        log_factor = math.log(total_emails + 1) / math.log(200) if total_emails > 0 else 0
        recency = 0.15
        if last_seen:
            try:
                ls = datetime.fromisoformat(last_seen)
                months_ago = (now - ls).days / 30
                if months_ago < 6:
                    recency = 1.0
                elif months_ago < 18:
                    recency = 0.7
                elif months_ago < 36:
                    recency = 0.4
                else:
                    recency = 0.15
            except Exception:
                pass
        reciprocity = 1.5 if d["sent"] > 0 and d["received"] > 0 else 1.0
        warmth = min(1.0, log_factor * recency * reciprocity)

        # Trajectory
        if len(dates) >= 4:
            mid = len(dates) // 2
            first_half_months = set(dt[:7] for dt in dates[:mid])
            second_half_months = set(dt[:7] for dt in dates[mid:])
            if len(second_half_months) > len(first_half_months) * 1.2:
                trajectory = "rising"
            elif len(second_half_months) < len(first_half_months) * 0.8:
                trajectory = "declining"
            else:
                trajectory = "stable"
        else:
            trajectory = "stable"

        phases_list = [p for p, c in d["phases"].most_common(5)] if d["phases"] else []
        unique_prefs = list(set(d["preferences"]))[:10]

        profile_batch.append((
            addr, name, domain, int(addr in OPERATOR_EMAILS),
            d["sent"], d["received"], d["cc"],
            len(d["correspondents"]),
            first_seen, last_seen, active_months,
            peak_day, peak_hour, pref_lang,
            round(avg_form, 3), None, None,  # avg/median response time computed later
            round(initiator_ratio, 3), round(cc_ratio, 3),
            round(density, 2), pattern, phase,
            round(attach_rate, 3), round(fin_rate, 3),
            json.dumps(phases_list), 0, 0,  # thread_count, avg_thread_depth
            json.dumps(unique_prefs),
            round(warmth, 3), trajectory,
            json.dumps(list(d["source_accounts"])),
        ))

        if len(profile_batch) >= 1000:
            conn.executemany("""INSERT OR IGNORE INTO person_profiles VALUES (
                ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
            )""", profile_batch)
            profile_batch = []

    if profile_batch:
        conn.executemany("""INSERT OR IGNORE INTO person_profiles VALUES (
            ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
        )""", profile_batch)
    conn.commit()

    count = cur.execute("SELECT COUNT(*) FROM person_profiles").fetchone()[0]
    print(f"  Person profiles built: {count:,}")

# ── PHASE 4: ORG PROFILES ────────────────────────────────────────────────────

def build_org_profiles(conn):
    print("\nPhase 4: Building org profiles...")
    cur = conn.cursor()

    # Country TLD mapping
    TLD_COUNTRY = {
        "fr": "France", "uk": "UK", "co.uk": "UK", "de": "Germany",
        "it": "Italy", "es": "Spain", "ch": "Switzerland", "be": "Belgium",
        "nl": "Netherlands", "us": "USA", "com": "", "org": "", "net": "",
    }

    orgs = cur.execute("""
        SELECT domain,
               COUNT(DISTINCT email) as contact_count,
               SUM(total_sent + total_received) as total_emails,
               MIN(first_seen) as first_seen,
               MAX(last_seen) as last_seen,
               COUNT(DISTINCT SUBSTR(first_seen, 1, 7)) as active_months,
               SUM(CASE WHEN financial_rate > 0 THEN 1 ELSE 0 END) as fin_count,
               AVG(relationship_warmth) as avg_warmth,
               GROUP_CONCAT(DISTINCT source_accounts) as all_accounts
        FROM person_profiles
        WHERE domain != '' AND is_operator = 0
        GROUP BY domain
    """).fetchall()

    batch = []
    for row in orgs:
        domain = row[0]
        if not domain:
            continue

        # Infer name from domain
        name_parts = domain.split('.')
        inferred_name = name_parts[0].replace('-', ' ').replace('_', ' ').title()

        # Country from TLD
        tld = name_parts[-1] if name_parts else ""
        country = TLD_COUNTRY.get(tld, "")

        # Primary operator
        op = cur.execute("""
            SELECT e.from_email, COUNT(*) as cnt
            FROM email_observations e
            WHERE e.from_email IN (SELECT email FROM person_profiles WHERE is_operator=1)
            AND (e.to_emails LIKE ? OR e.cc_emails LIKE ?)
            GROUP BY e.from_email ORDER BY cnt DESC LIMIT 1
        """, (f'%{domain}%', f'%{domain}%')).fetchone()
        primary_op = op[0] if op else ""

        # Seasonal peak
        months_data = cur.execute("""
            SELECT CAST(SUBSTR(date, 6, 2) AS INTEGER) as m, COUNT(*) as c
            FROM email_observations
            WHERE from_domain = ? AND date IS NOT NULL
            GROUP BY m ORDER BY c DESC LIMIT 1
        """, (domain,)).fetchone()
        peak_month = months_data[0] if months_data else 1

        # Parse source accounts from concatenated string
        accts = row[8] or ""
        try:
            # It's a concatenated string from GROUP_CONCAT
            acct_list = list(set(a.strip().strip('"[]') for a in accts.replace('][', ',').replace('[', '').replace(']', '').split(',') if a.strip()))
        except Exception:
            acct_list = []

        batch.append((
            domain, inferred_name, country,
            row[1],  # contact_count
            row[2] or 0,  # total_emails
            row[3],  # first_seen
            row[4],  # last_seen
            row[5] or 0,  # active_months
            None,  # avg_response_time
            peak_month,
            row[6] or 0,  # financial_signal_count
            0,  # thread_count
            round(row[7] or 0, 3),  # relationship_health
            primary_op,
            json.dumps(acct_list),
        ))

        if len(batch) >= 1000:
            conn.executemany("INSERT OR IGNORE INTO org_profiles VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", batch)
            batch = []

    if batch:
        conn.executemany("INSERT OR IGNORE INTO org_profiles VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", batch)
    conn.commit()

    count = cur.execute("SELECT COUNT(*) FROM org_profiles").fetchone()[0]
    print(f"  Org profiles built: {count:,}")

# ── PHASE 5: RELATIONSHIP EDGES ──────────────────────────────────────────────

def build_relationship_edges(conn):
    print("\nPhase 5: Building relationship edges...")
    cur = conn.cursor()

    edges = defaultdict(lambda: {"weight": 0, "first": None, "last": None, "dates": []})

    batch_size = 50000
    offset = 0
    while True:
        rows = cur.execute(f"""
            SELECT from_email, to_emails, cc_emails, date
            FROM email_observations
            WHERE from_email IS NOT NULL AND from_email != ''
            LIMIT {batch_size} OFFSET {offset}
        """).fetchall()
        if not rows:
            break
        offset += batch_size

        for from_email, to_j, cc_j, date in rows:
            try:
                to_list = json.loads(to_j) if to_j else []
            except Exception:
                to_list = []
            try:
                cc_list = json.loads(cc_j) if cc_j else []
            except Exception:
                cc_list = []

            for e in to_list:
                if e and e != from_email:
                    key = (from_email, e, "to")
                    d = edges[key]
                    d["weight"] += 1
                    if date:
                        if not d["first"] or date < d["first"]:
                            d["first"] = date
                        if not d["last"] or date > d["last"]:
                            d["last"] = date

            for e in cc_list:
                if e and e != from_email:
                    key = (from_email, e, "cc")
                    d = edges[key]
                    d["weight"] += 1
                    if date:
                        if not d["first"] or date < d["first"]:
                            d["first"] = date
                        if not d["last"] or date > d["last"]:
                            d["last"] = date

    print(f"  Computing {len(edges):,} edges...")

    # Check reciprocity
    edge_keys = set(edges.keys())
    batch = []

    for (src, tgt, etype), d in edges.items():
        # Check if reverse exists
        reverse = (tgt, src, etype)
        is_recip = int(reverse in edge_keys)

        # Avg interval
        total_days = 0
        if d["first"] and d["last"] and d["weight"] > 1:
            try:
                f = datetime.fromisoformat(d["first"])
                l = datetime.fromisoformat(d["last"])
                total_days = (l - f).days / max(d["weight"] - 1, 1)
            except Exception:
                pass

        batch.append((src, tgt, d["weight"], etype, d["first"], d["last"], is_recip, round(total_days, 1)))

        if len(batch) >= 5000:
            conn.executemany("INSERT OR IGNORE INTO relationship_edges VALUES (?,?,?,?,?,?,?,?)", batch)
            batch = []

    if batch:
        conn.executemany("INSERT OR IGNORE INTO relationship_edges VALUES (?,?,?,?,?,?,?,?)", batch)
    conn.commit()

    count = cur.execute("SELECT COUNT(*) FROM relationship_edges").fetchone()[0]
    print(f"  Relationship edges built: {count:,}")

# ── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    start = time.time()
    print("=" * 70)
    print("UNIVERSAL EMAIL INTELLIGENCE EXTRACTION")
    print(f"Output: {DB_PATH}")
    print("=" * 70)

    conn = create_database()
    total_messages = 0

    # Phase 1: Extract all emails
    print("\n--- Phase 1: Email Extraction ---")

    # MBOX files
    print("\nProcessing MBOX files...")
    for rel_path, account, direction in MBOX_SOURCES:
        filepath = os.path.join(HOME, rel_path)
        count = stream_mbox(filepath, account, direction, conn)
        total_messages += count

    # EMLX files
    print("\nProcessing EMLX files...")
    emlx_count = process_emlx_dirs(conn)
    total_messages += emlx_count

    elapsed = time.time() - start
    obs_count = conn.execute("SELECT COUNT(*) FROM email_observations").fetchone()[0]
    print(f"\n  Phase 1 complete: {obs_count:,} unique emails in {elapsed:.0f}s")

    # Phase 2-5
    build_threads(conn)
    build_person_profiles(conn)
    build_org_profiles(conn)
    build_relationship_edges(conn)

    # Create useful indexes
    print("\nCreating final indexes...")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_obs_from_domain ON email_observations(from_domain)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_obs_direction ON email_observations(source_direction)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_threads_date ON threads(first_date)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_edges_src ON relationship_edges(source_email)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_edges_tgt ON relationship_edges(target_email)")
    conn.commit()

    # Final summary
    elapsed = time.time() - start
    print("\n" + "=" * 70)
    print("EXTRACTION COMPLETE")
    print("=" * 70)

    tables = ["email_observations", "threads", "person_profiles", "org_profiles", "relationship_edges"]
    for t in tables:
        count = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"  {t}: {count:,} rows")

    db_size = os.path.getsize(DB_PATH) / (1024 * 1024)
    print(f"\n  Database size: {db_size:.1f} MB")
    print(f"  Total runtime: {elapsed:.0f}s ({elapsed/60:.1f} minutes)")
    print(f"  Output: {DB_PATH}")

    conn.close()

if __name__ == "__main__":
    main()
