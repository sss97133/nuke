#!/usr/bin/env python3
"""
Build a comprehensive email relationship matrix from ALL MBOX files.

Outputs:
  - RELATIONSHIP_MATRIX.csv  (directed pair: sender -> recipient)
  - CONTACT_PROFILES.csv     (one row per unique email)
  - NETWORK_EDGES.csv        (simplified graph for visualization)

Processes MBOX files line-by-line (headers only) to handle multi-GB files.
"""

import csv
import os
import re
import sys
import time
import signal
from collections import defaultdict
from datetime import datetime, timedelta
from email.utils import parseaddr, parsedate_to_datetime, getaddresses
from pathlib import Path

# ── Configuration ──────────────────────────────────────────────────────────

OUTPUT_DIR = Path(os.path.expanduser("~/relationship_data"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

HOME = os.path.expanduser("~")
MBOX_FILES = [
    f"{HOME}/jenny_tpo_email_archive/inbox.mbox",
    f"{HOME}/jenny_tpo_email_archive/sent_messages.mbox",
    f"{HOME}/jenny_tpo_email_archive/archive.mbox",
    f"{HOME}/jenny_tpo_email_archive/drafts.mbox",
    f"{HOME}/philippe_tpo_email_archive/inbox.mbox",
    f"{HOME}/philippe_tpo_email_archive/sent_messages.mbox",
    f"{HOME}/philippe_tpo_email_archive/archive.mbox",
    f"{HOME}/philippe_tpo_email_archive/drafts.mbox",
    f"{HOME}/ionos_email_archive/ionos_archive.mbox",
    f"{HOME}/ionos_email_archive/ionos_sent_and_others.mbox",
]

# Comma-separated list of the archive owners' own addresses (kept out of the
# repo — these identify real mailboxes)
OPERATOR_ADDRESSES = {
    a.strip().lower()
    for a in os.environ.get("PUBLISHING_OPERATOR_EMAILS", "").split(",")
    if a.strip()
}

PROGRESS_INTERVAL = 5000
TIMEOUT_SECONDS = 540  # 9 minutes to leave room for CSV writing

# ── Global state ───────────────────────────────────────────────────────────

# Directed pair stats: (sender, recipient) -> {...}
pair_stats = defaultdict(lambda: {
    "count": 0,
    "cc_count": 0,
    "dates": [],
})

# Contact profiles: email -> {...}
contact_data = defaultdict(lambda: {
    "names": [],           # list of (display_name, source) tuples
    "sent": 0,
    "received": 0,
    "cc": 0,
    "dates": [],
    "correspondents": set(),
    "mailboxes": set(),
})

# For reply-time detection: keyed by normalized subject -> list of (date, sender)
thread_tracker = defaultdict(list)

# Accumulate reply times per email address
reply_times = defaultdict(list)

start_time = time.time()
timed_out = False
files_processed = []
files_skipped = []


def check_timeout():
    global timed_out
    if time.time() - start_time > TIMEOUT_SECONDS:
        timed_out = True
        return True
    return False


# ── Email parsing helpers ──────────────────────────────────────────────────

EMAIL_RE = re.compile(r'[\w.+-]+@[\w.-]+\.\w{2,}', re.ASCII)

def clean_email(addr):
    """Normalize an email address."""
    if not addr:
        return None
    addr = addr.strip().lower()
    # Strip angle brackets if present
    if addr.startswith('<'):
        addr = addr.lstrip('<').rstrip('>')
    addr = addr.strip()
    if '@' not in addr or '.' not in addr.split('@')[-1]:
        return None
    # Filter out obvious non-addresses
    if addr.startswith('undisclosed') or addr.startswith('no-reply'):
        return None
    return addr


def parse_address_list(header_value):
    """Parse a To/Cc/From header into list of (name, email) tuples."""
    if not header_value:
        return []
    results = []
    # Use email.utils.getaddresses for robust parsing
    try:
        pairs = getaddresses([header_value])
    except Exception:
        # Fallback: extract emails with regex
        for m in EMAIL_RE.finditer(header_value):
            results.append(("", m.group(0).lower()))
        return results

    for display_name, addr in pairs:
        addr = clean_email(addr)
        if addr:
            results.append((display_name.strip(), addr))

    # If getaddresses found nothing, try regex
    if not results:
        for m in EMAIL_RE.finditer(header_value):
            results.append(("", m.group(0).lower()))

    return results


def parse_date(date_str):
    """Parse a Date header into a naive-UTC datetime object."""
    if not date_str:
        return None
    dt = None
    try:
        dt = parsedate_to_datetime(date_str)
    except Exception:
        pass
    if dt is None:
        for fmt in ("%a, %d %b %Y %H:%M:%S", "%d %b %Y %H:%M:%S",
                    "%Y-%m-%d %H:%M:%S", "%a %b %d %H:%M:%S %Y"):
            try:
                dt = datetime.strptime(date_str.strip()[:30], fmt)
                break
            except Exception:
                continue
    if dt is None:
        return None
    # Normalize to naive UTC to avoid offset-aware vs offset-naive issues
    if dt.tzinfo is not None:
        from datetime import timezone
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def infer_name_from_local(email_addr):
    """Infer first/last name from the local part of an email address."""
    local = email_addr.split('@')[0]
    # Common patterns: firstname.lastname, firstname_lastname, firstnamelastname
    parts = re.split(r'[._-]', local)
    parts = [p for p in parts if p and not p.isdigit()]
    if len(parts) >= 2:
        return parts[0].capitalize(), parts[-1].capitalize(), "inferred"
    elif len(parts) == 1 and parts[0]:
        return parts[0].capitalize(), "", "inferred"
    return "", "", "unknown"


def extract_name(display_name, email_addr):
    """Extract first/last name from display name or infer from email."""
    if display_name:
        # Clean up display name
        name = display_name.strip().strip('"').strip("'").strip()
        if name and '@' not in name:
            parts = name.split()
            if len(parts) >= 2:
                return parts[0], " ".join(parts[1:]), "header"
            elif len(parts) == 1:
                return parts[0], "", "header"
    return infer_name_from_local(email_addr)


def normalize_subject(subj):
    """Strip Re:/Fwd: prefixes for thread matching."""
    if not subj:
        return ""
    s = subj.strip()
    while True:
        m = re.match(r'^(Re|RE|Fwd|FWD|Fw|FW)\s*:\s*', s)
        if m:
            s = s[m.end():]
        else:
            break
    return s.strip().lower()[:100]  # Truncate for memory


def is_reply(subj):
    """Check if subject indicates a reply."""
    if not subj:
        return False
    return bool(re.match(r'^(Re|RE)\s*:', subj.strip()))


# ── MBOX streaming parser ─────────────────────────────────────────────────

def stream_mbox_headers(filepath):
    """
    Generator that yields header dicts for each message in an MBOX file.
    Reads line-by-line. Only extracts From, To, Cc, Date, Subject headers.
    Handles header folding (continuation lines starting with space/tab).
    """
    msg_count = 0
    in_headers = False
    current_header = None
    current_value = None
    headers = {}

    target_headers = {'from', 'to', 'cc', 'date', 'subject'}

    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            for line in f:
                # MBOX separator: line starting with "From " at the start
                if line.startswith('From '):
                    # Yield previous message if we have headers
                    if headers:
                        # Flush last header
                        if current_header and current_header in target_headers:
                            headers[current_header] = current_value
                        yield headers
                        msg_count += 1
                        if msg_count % PROGRESS_INTERVAL == 0:
                            elapsed = time.time() - start_time
                            print(f"  [{os.path.basename(filepath)}] {msg_count:,} messages processed ({elapsed:.0f}s elapsed)")
                    headers = {}
                    current_header = None
                    current_value = None
                    in_headers = True
                    continue

                if not in_headers:
                    continue

                # Empty line = end of headers
                if line.strip() == '':
                    if current_header and current_header in target_headers:
                        headers[current_header] = current_value
                    in_headers = False
                    current_header = None
                    current_value = None
                    continue

                # Header continuation line (starts with space or tab)
                if line[0] in (' ', '\t'):
                    if current_header and current_header in target_headers:
                        current_value = (current_value or '') + ' ' + line.strip()
                    continue

                # New header line
                colon_pos = line.find(':')
                if colon_pos > 0:
                    # Flush previous header
                    if current_header and current_header in target_headers:
                        headers[current_header] = current_value

                    header_name = line[:colon_pos].strip().lower()
                    current_header = header_name
                    current_value = line[colon_pos + 1:].strip()

        # Don't forget the last message
        if headers:
            if current_header and current_header in target_headers:
                headers[current_header] = current_value
            yield headers
            msg_count += 1

    except FileNotFoundError:
        print(f"  WARNING: File not found: {filepath}")
    except Exception as e:
        print(f"  ERROR reading {filepath}: {e}")

    print(f"  [{os.path.basename(filepath)}] DONE: {msg_count:,} messages total")


# ── Main processing ───────────────────────────────────────────────────────

def process_mbox(filepath):
    """Process a single MBOX file and accumulate data into global structures."""
    mbox_label = os.path.basename(filepath)
    parent_dir = os.path.basename(os.path.dirname(filepath))
    mbox_id = f"{parent_dir}/{mbox_label}"
    print(f"\nProcessing: {mbox_id}")

    if not os.path.exists(filepath):
        print(f"  SKIPPED: file does not exist")
        files_skipped.append(mbox_id)
        return

    file_size = os.path.getsize(filepath)
    print(f"  Size: {file_size / (1024**3):.2f} GB")

    msg_count = 0
    for headers in stream_mbox_headers(filepath):
        if check_timeout():
            print(f"  TIMEOUT after {msg_count:,} messages")
            files_skipped.append(f"{mbox_id} (partial: {msg_count:,} msgs)")
            return

        msg_count += 1

        # Parse headers
        from_list = parse_address_list(headers.get('from', ''))
        to_list = parse_address_list(headers.get('to', ''))
        cc_list = parse_address_list(headers.get('cc', ''))
        date = parse_date(headers.get('date', ''))
        subject = headers.get('subject', '')

        if not from_list:
            continue

        sender_name, sender_email = from_list[0]
        if not sender_email:
            continue

        date_val = date  # Could be None

        # Update sender contact data
        cd = contact_data[sender_email]
        cd["sent"] += 1
        if sender_name:
            cd["names"].append((sender_name, "header"))
        if date_val:
            cd["dates"].append(date_val)
        cd["mailboxes"].add(mbox_id)

        # Process To recipients
        for recip_name, recip_email in to_list:
            if not recip_email:
                continue

            # Pair stats
            key = (sender_email, recip_email)
            ps = pair_stats[key]
            ps["count"] += 1
            if date_val:
                ps["dates"].append(date_val)

            # Recipient contact data
            rcd = contact_data[recip_email]
            rcd["received"] += 1
            if recip_name:
                rcd["names"].append((recip_name, "header"))
            if date_val:
                rcd["dates"].append(date_val)
            rcd["mailboxes"].add(mbox_id)

            # Track correspondents
            cd["correspondents"].add(recip_email)
            rcd["correspondents"].add(sender_email)

        # Process Cc recipients
        for recip_name, recip_email in cc_list:
            if not recip_email:
                continue

            key = (sender_email, recip_email)
            ps = pair_stats[key]
            ps["cc_count"] += 1
            if ps["count"] == 0:
                # Only count as a CC-only interaction if no To interaction recorded here
                pass
            if date_val:
                ps["dates"].append(date_val)

            rcd = contact_data[recip_email]
            rcd["cc"] += 1
            if recip_name:
                rcd["names"].append((recip_name, "header"))
            if date_val:
                rcd["dates"].append(date_val)
            rcd["mailboxes"].add(mbox_id)

            cd["correspondents"].add(recip_email)
            rcd["correspondents"].add(sender_email)

        # Thread tracking for reply-time estimation
        norm_subj = normalize_subject(subject)
        if norm_subj and date_val:
            if is_reply(subject):
                # Look for the original message in the thread
                for prev_date, prev_sender in thread_tracker.get(norm_subj, []):
                    # The replier is the current sender; the original sender is prev_sender
                    if prev_sender != sender_email:
                        delta = (date_val - prev_date).total_seconds() / 3600.0
                        if 0 < delta < 168:  # Within 7 days (168 hours)
                            reply_times[sender_email].append(delta)
                            break  # Only match the most recent prior message

            # Add this message to the thread tracker
            thread_tracker[norm_subj].append((date_val, sender_email))
            # Keep thread tracker from growing too large: only keep last 5 per subject
            if len(thread_tracker[norm_subj]) > 5:
                thread_tracker[norm_subj] = thread_tracker[norm_subj][-5:]

    files_processed.append(mbox_id)


def build_reciprocal_set():
    """Build a set of all (a, b) pairs where communication goes both ways."""
    senders = set()
    for (s, r) in pair_stats:
        senders.add((s, r))
    reciprocal = set()
    for (s, r) in senders:
        if (r, s) in senders:
            reciprocal.add((s, r))
    return reciprocal


def write_relationship_matrix(reciprocal_set):
    """Write RELATIONSHIP_MATRIX.csv."""
    outpath = OUTPUT_DIR / "RELATIONSHIP_MATRIX.csv"
    print(f"\nWriting {outpath} ...")

    with open(outpath, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow([
            "sender_email", "sender_domain", "recipient_email", "recipient_domain",
            "email_count", "first_interaction", "last_interaction", "duration_days",
            "avg_interval_days", "is_reciprocal", "cc_count"
        ])

        for (sender, recipient), stats in sorted(pair_stats.items()):
            total = stats["count"] + (stats["cc_count"] if stats["count"] == 0 else 0)
            if total == 0 and stats["cc_count"] == 0:
                continue

            email_count = stats["count"] if stats["count"] > 0 else stats["cc_count"]
            dates = sorted(stats["dates"]) if stats["dates"] else []
            first = dates[0].strftime("%Y-%m-%d") if dates else ""
            last = dates[-1].strftime("%Y-%m-%d") if dates else ""

            if dates and len(dates) >= 2:
                duration = (dates[-1] - dates[0]).days
            else:
                duration = 0

            if dates and len(dates) >= 2:
                intervals = [(dates[i+1] - dates[i]).days for i in range(len(dates)-1)]
                avg_interval = sum(intervals) / len(intervals) if intervals else 0
            else:
                avg_interval = 0

            is_recip = (sender, recipient) in reciprocal_set

            writer.writerow([
                sender,
                sender.split('@')[-1] if '@' in sender else '',
                recipient,
                recipient.split('@')[-1] if '@' in recipient else '',
                email_count,
                first,
                last,
                duration,
                round(avg_interval, 1),
                is_recip,
                stats["cc_count"],
            ])

    row_count = len(pair_stats)
    print(f"  Written {row_count:,} rows")


def write_contact_profiles():
    """Write CONTACT_PROFILES.csv."""
    outpath = OUTPUT_DIR / "CONTACT_PROFILES.csv"
    print(f"\nWriting {outpath} ...")

    with open(outpath, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow([
            "email", "domain", "inferred_first_name", "inferred_last_name",
            "name_source", "total_sent", "total_received", "total_cc",
            "unique_correspondents", "first_seen", "last_seen",
            "active_months", "peak_month", "avg_response_time_hours",
            "is_operator", "appears_in_mailboxes"
        ])

        for email_addr in sorted(contact_data.keys()):
            cd = contact_data[email_addr]

            # Determine best name
            first_name, last_name, name_source = "", "", "unknown"
            # Prefer header-sourced names
            header_names = [(n, s) for n, s in cd["names"] if s == "header" and n]
            if header_names:
                # Pick the most common header name
                name_counts = defaultdict(int)
                for n, _ in header_names:
                    name_counts[n] += 1
                best_name = max(name_counts, key=name_counts.get)
                first_name, last_name, name_source = extract_name(best_name, email_addr)
            else:
                first_name, last_name, name_source = infer_name_from_local(email_addr)

            dates = sorted(cd["dates"]) if cd["dates"] else []
            first_seen = dates[0].strftime("%Y-%m-%d") if dates else ""
            last_seen = dates[-1].strftime("%Y-%m-%d") if dates else ""

            # Active months
            month_counts = defaultdict(int)
            for d in dates:
                ym = d.strftime("%Y-%m")
                month_counts[ym] += 1

            active_months = len(month_counts)
            peak_month = max(month_counts, key=month_counts.get) if month_counts else ""

            # Reply time
            rt = reply_times.get(email_addr, [])
            avg_rt = round(sum(rt) / len(rt), 1) if rt else ""

            is_op = email_addr in OPERATOR_ADDRESSES

            mailboxes = "; ".join(sorted(cd["mailboxes"]))

            writer.writerow([
                email_addr,
                email_addr.split('@')[-1] if '@' in email_addr else '',
                first_name,
                last_name,
                name_source,
                cd["sent"],
                cd["received"],
                cd["cc"],
                len(cd["correspondents"]),
                first_seen,
                last_seen,
                active_months,
                peak_month,
                avg_rt,
                is_op,
                mailboxes,
            ])

    print(f"  Written {len(contact_data):,} rows")


def write_network_edges():
    """Write NETWORK_EDGES.csv."""
    outpath = OUTPUT_DIR / "NETWORK_EDGES.csv"
    print(f"\nWriting {outpath} ...")

    with open(outpath, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(["source", "target", "weight", "type", "first_date", "last_date"])

        for (sender, recipient), stats in sorted(pair_stats.items()):
            dates = sorted(stats["dates"]) if stats["dates"] else []
            first = dates[0].strftime("%Y-%m-%d") if dates else ""
            last = dates[-1].strftime("%Y-%m-%d") if dates else ""

            if stats["count"] > 0:
                writer.writerow([sender, recipient, stats["count"], "to", first, last])
            if stats["cc_count"] > 0:
                writer.writerow([sender, recipient, stats["cc_count"], "cc", first, last])

    print(f"  Written NETWORK_EDGES.csv")


# ── Entry point ────────────────────────────────────────────────────────────

def main():
    global timed_out

    print("=" * 70)
    print("EMAIL RELATIONSHIP MATRIX BUILDER")
    print("=" * 70)
    print(f"Start time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Timeout budget: {TIMEOUT_SECONDS}s")
    print(f"Output dir: {OUTPUT_DIR}")
    print(f"MBOX files to scan: {len(MBOX_FILES)}")

    for mbox_path in MBOX_FILES:
        if timed_out:
            remaining = [os.path.basename(p) for p in MBOX_FILES if p not in [m for m in MBOX_FILES[:MBOX_FILES.index(mbox_path)]]]
            files_skipped.extend([f"{os.path.basename(os.path.dirname(p))}/{os.path.basename(p)} (timeout)" for p in MBOX_FILES[MBOX_FILES.index(mbox_path):]])
            break
        process_mbox(mbox_path)

    # Free thread tracker memory before writing CSVs
    thread_tracker.clear()

    # Free the names lists (keep only the computed name later)
    # Actually we need them for contact profiles, so skip this

    print("\n" + "=" * 70)
    print("WRITING OUTPUT FILES")
    print("=" * 70)

    reciprocal_set = build_reciprocal_set()
    write_relationship_matrix(reciprocal_set)
    write_contact_profiles()
    write_network_edges()

    elapsed = time.time() - start_time
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print(f"Total time: {elapsed:.0f}s ({elapsed/60:.1f} min)")
    print(f"Unique email addresses: {len(contact_data):,}")
    print(f"Directed pairs: {len(pair_stats):,}")
    print(f"Files processed: {len(files_processed)}")
    for f in files_processed:
        print(f"  OK: {f}")
    if files_skipped:
        print(f"Files skipped/partial: {len(files_skipped)}")
        for f in files_skipped:
            print(f"  SKIP: {f}")
    print(f"\nOutputs:")
    print(f"  {OUTPUT_DIR / 'RELATIONSHIP_MATRIX.csv'}")
    print(f"  {OUTPUT_DIR / 'CONTACT_PROFILES.csv'}")
    print(f"  {OUTPUT_DIR / 'NETWORK_EDGES.csv'}")


if __name__ == "__main__":
    main()
