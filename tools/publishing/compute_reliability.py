#!/usr/bin/env python3
"""
compute_reliability.py — Compute reliability scores and ghost risk for each
contact in email_intelligence.db, using both email and iMessage data.
"""

import sqlite3
import json
import os
from datetime import datetime, timedelta
from collections import defaultdict

DB_PATH = os.path.expanduser("~/email_intelligence.db")
TODAY = datetime(2026, 4, 9)  # reference date for ghost detection

def ensure_columns(cur):
    """Add new columns to person_profiles if they don't exist."""
    existing = {row[1] for row in cur.execute("PRAGMA table_info(person_profiles)").fetchall()}
    new_cols = [
        ("reliability_score", "REAL"),
        ("reliability_factors", "TEXT"),
        ("ghost_status", "TEXT"),
        ("responsiveness_hours", "REAL"),
        ("ghost_risk", "REAL"),
        ("imessage_contact", "TEXT"),
        ("imessage_volume", "INTEGER"),
        ("cross_channel_score", "REAL"),
    ]
    for col, typ in new_cols:
        if col not in existing:
            cur.execute(f"ALTER TABLE person_profiles ADD COLUMN {col} {typ}")
            print(f"  Added column {col}")
        else:
            print(f"  Column {col} already exists")


def build_imessage_email_map(cur):
    """Build mapping from email -> iMessage volume for email-based iMessage senders."""
    rows = cur.execute("""
        SELECT lower(sender), COUNT(*) FROM imessage_observations
        WHERE sender LIKE '%@%'
        GROUP BY lower(sender)
    """).fetchall()
    return {email: count for email, count in rows}


def build_imessage_name_map(cur):
    """Build mapping from lowercase name -> (sender_id, volume) for name-based matching."""
    # For phone-number senders, try matching by chat_display_name
    rows = cur.execute("""
        SELECT chat_display_name, sender, COUNT(*) FROM imessage_observations
        WHERE sender NOT LIKE '%@%'
          AND chat_display_name IS NOT NULL AND chat_display_name != ''
          AND is_group = 0
        GROUP BY chat_display_name, sender
    """).fetchall()
    name_map = {}
    for display_name, sender, count in rows:
        key = display_name.strip().lower()
        if key:
            if key not in name_map or count > name_map[key][1]:
                name_map[key] = (sender, count)
    return name_map


def compute_email_responsiveness(cur, email):
    """Compute average response time in hours from relationship_edges."""
    row = cur.execute("""
        SELECT avg_interval_days FROM relationship_edges
        WHERE target_email = ? AND type = 'direct'
        ORDER BY weight DESC LIMIT 1
    """, (email,)).fetchone()
    if row and row[0] is not None:
        return row[0] * 24.0  # convert days to hours
    # Fallback: use avg_response_time_hours from person_profiles
    row = cur.execute("""
        SELECT avg_response_time_hours FROM person_profiles WHERE email = ?
    """, (email,)).fetchone()
    if row and row[0] is not None:
        return row[0]
    return None


def compute_imessage_responsiveness(cur, imessage_id):
    """Compute average reply time from consecutive iMessage pairs."""
    if not imessage_id:
        return None
    # Get messages in chats involving this sender, ordered by date
    rows = cur.execute("""
        SELECT date, is_from_me, sender FROM imessage_observations
        WHERE chat_id IN (
            SELECT DISTINCT chat_id FROM imessage_observations WHERE sender = ?
        )
        AND is_group = 0
        ORDER BY date
    """, (imessage_id,)).fetchall()

    if len(rows) < 2:
        return None

    reply_times = []
    for i in range(1, len(rows)):
        prev_date, prev_from_me, prev_sender = rows[i-1]
        curr_date, curr_from_me, curr_sender = rows[i]
        # Looking for: Jenny sent -> contact replied, or contact sent -> Jenny replied
        # We want the contact's reply time (they reply to Jenny)
        if prev_from_me == 1 and curr_from_me == 0 and curr_sender == imessage_id:
            try:
                t0 = datetime.fromisoformat(prev_date.replace('Z', '+00:00') if 'Z' in str(prev_date) else prev_date)
                t1 = datetime.fromisoformat(curr_date.replace('Z', '+00:00') if 'Z' in str(curr_date) else curr_date)
                diff_hours = (t1 - t0).total_seconds() / 3600.0
                if 0 < diff_hours < 168 * 4:  # cap at 4 weeks
                    reply_times.append(diff_hours)
            except (ValueError, TypeError):
                continue

    if reply_times:
        return sum(reply_times) / len(reply_times)
    return None


def compute_consistency(first_seen, last_seen, active_months):
    """Compute consistency as active_months / total_span_months."""
    if not first_seen or not last_seen or not active_months:
        return 0.0
    try:
        t0 = datetime.fromisoformat(first_seen[:10])
        t1 = datetime.fromisoformat(last_seen[:10])
        span_months = max((t1 - t0).days / 30.44, 1)
        return min(active_months / span_months, 1.0)
    except (ValueError, TypeError):
        return 0.0


def compute_ghost_status(last_seen, total_messages, consistency):
    """Classify ghost status."""
    if not last_seen:
        return 'unknown', 1.0
    try:
        last_dt = datetime.fromisoformat(last_seen[:10])
    except (ValueError, TypeError):
        return 'unknown', 1.0

    days_since = (TODAY - last_dt).days

    if total_messages < 20:
        # Map days_since to ghost_risk even for low volume
        risk = min(days_since / 365.0, 1.0)
        return 'low_volume', risk

    if days_since < 30:
        return 'active', max(0, days_since / 365.0)
    elif days_since < 90:
        # 'cooling' if was previously regular
        if consistency >= 0.3:  # roughly 1 msg/month or more
            return 'cooling', days_since / 365.0
        else:
            return 'dormant', days_since / 365.0
    elif days_since < 365:
        return 'dormant', min(days_since / 365.0, 0.95)
    else:
        return 'ghosted', 1.0


def compute_reciprocity(total_sent, total_received):
    """min(sent, received) / max(sent, received)."""
    s = total_sent or 0
    r = total_received or 0
    if s == 0 and r == 0:
        return 0.0
    return min(s, r) / max(s, r)


def compute_volume_bonus(total_messages):
    """More data = higher confidence, capped at 1.0."""
    # Logarithmic scale: 10 msgs -> ~0.3, 100 -> ~0.6, 1000 -> ~0.9
    import math
    if total_messages <= 0:
        return 0.0
    return min(math.log10(total_messages) / 3.5, 1.0)


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    print("=== Compute Reliability Scores ===\n")

    # Step 1: Ensure columns
    print("Step 1: Ensuring columns exist...")
    ensure_columns(cur)
    conn.commit()

    # Build iMessage lookup maps
    print("\nStep 2: Building iMessage lookup maps...")
    imsg_email_map = build_imessage_email_map(cur)
    imsg_name_map = build_imessage_name_map(cur)
    print(f"  iMessage contacts by email: {len(imsg_email_map)}")
    print(f"  iMessage contacts by name: {len(imsg_name_map)}")

    # Step 2: Process each person with >= 10 total emails
    print("\nStep 3: Computing reliability for qualifying contacts...")
    profiles = cur.execute("""
        SELECT email, name, total_sent, total_received, first_seen, last_seen,
               active_months, avg_response_time_hours
        FROM person_profiles
        WHERE (COALESCE(total_sent, 0) + COALESCE(total_received, 0)) >= 10
    """).fetchall()

    print(f"  Processing {len(profiles)} contacts with >= 10 emails...\n")

    results = []
    ghost_counts = defaultdict(int)
    cross_channel_count = 0

    for i, p in enumerate(profiles):
        email = p['email']
        name = p['name'] or ''
        total_sent = p['total_sent'] or 0
        total_received = p['total_received'] or 0
        total_messages = total_sent + total_received
        first_seen = p['first_seen']
        last_seen = p['last_seen']
        active_months = p['active_months'] or 0

        # --- iMessage matching ---
        imessage_id = None
        imessage_vol = 0
        email_lower = email.lower()

        # Direct email match
        if email_lower in imsg_email_map:
            imessage_id = email_lower
            imessage_vol = imsg_email_map[email_lower]
        else:
            # Name match (try full name)
            name_lower = name.strip().lower()
            if name_lower and name_lower in imsg_name_map:
                imessage_id = imsg_name_map[name_lower][0]
                imessage_vol = imsg_name_map[name_lower][1]

        # --- a. Email responsiveness ---
        email_resp_hours = compute_email_responsiveness(cur, email)
        if email_resp_hours is not None and email_resp_hours > 0:
            email_resp_score = 1.0 - min(email_resp_hours / 168.0, 1.0)
        else:
            email_resp_score = 0.5  # neutral default

        # --- b. iMessage responsiveness ---
        imsg_resp_hours = None
        imsg_resp_score = None
        if imessage_id:
            imsg_resp_hours = compute_imessage_responsiveness(cur, imessage_id)
            if imsg_resp_hours is not None and imsg_resp_hours > 0:
                imsg_resp_score = 1.0 - min(imsg_resp_hours / 168.0, 1.0)

        # Combined responsiveness
        if imsg_resp_score is not None:
            responsiveness = (email_resp_score * 0.6 + imsg_resp_score * 0.4)
            resp_hours = email_resp_hours if email_resp_hours else 0
        else:
            responsiveness = email_resp_score
            resp_hours = email_resp_hours or 0

        # --- c. Consistency ---
        consistency = compute_consistency(first_seen, last_seen, active_months)

        # --- d. Ghost detection ---
        ghost_status, ghost_risk = compute_ghost_status(last_seen, total_messages, consistency)
        ghost_counts[ghost_status] += 1

        # --- e. Cross-channel ---
        channels = 1  # email always present
        if imessage_id:
            channels += 1
            cross_channel_count += 1
        cross_channel = channels / 2.0

        # --- f. Reciprocity ---
        reciprocity = compute_reciprocity(total_sent, total_received)

        # --- g. Volume bonus ---
        volume_bonus = compute_volume_bonus(total_messages)

        # --- Overall reliability ---
        ghost_risk_inverse = 1.0 - ghost_risk
        reliability = (
            responsiveness * 0.25 +
            consistency * 0.15 +
            ghost_risk_inverse * 0.20 +
            cross_channel * 0.10 +
            reciprocity * 0.15 +
            volume_bonus * 0.15
        )

        factors = {
            "responsiveness": round(responsiveness, 3),
            "email_resp_score": round(email_resp_score, 3),
            "email_resp_hours": round(resp_hours, 1) if resp_hours else None,
            "imsg_resp_score": round(imsg_resp_score, 3) if imsg_resp_score is not None else None,
            "imsg_resp_hours": round(imsg_resp_hours, 1) if imsg_resp_hours is not None else None,
            "consistency": round(consistency, 3),
            "ghost_risk_inverse": round(ghost_risk_inverse, 3),
            "ghost_risk": round(ghost_risk, 3),
            "ghost_status": ghost_status,
            "cross_channel": round(cross_channel, 3),
            "reciprocity": round(reciprocity, 3),
            "volume_bonus": round(volume_bonus, 3),
            "total_messages": total_messages,
            "channels": channels,
        }

        # Update database
        cur.execute("""
            UPDATE person_profiles SET
                reliability_score = ?,
                reliability_factors = ?,
                ghost_status = ?,
                responsiveness_hours = ?,
                ghost_risk = ?,
                imessage_contact = ?,
                imessage_volume = ?,
                cross_channel_score = ?
            WHERE email = ?
        """, (
            round(reliability, 4),
            json.dumps(factors),
            ghost_status,
            round(resp_hours, 2) if resp_hours else None,
            round(ghost_risk, 4),
            imessage_id,
            imessage_vol if imessage_id else None,
            round(cross_channel, 2),
            email,
        ))

        results.append({
            "email": email,
            "name": name,
            "reliability": reliability,
            "ghost_status": ghost_status,
            "ghost_risk": ghost_risk,
            "total_messages": total_messages,
            "imessage_id": imessage_id,
            "imessage_vol": imessage_vol,
            "cross_channel": cross_channel,
            "factors": factors,
        })

        if (i + 1) % 500 == 0:
            print(f"  Processed {i + 1}/{len(profiles)}...")

    conn.commit()

    # =========== SUMMARY ===========
    print(f"\n{'='*70}")
    print(f"  RELIABILITY ANALYSIS COMPLETE")
    print(f"{'='*70}")
    print(f"\n  Contacts analyzed: {len(results)}")
    print(f"  Cross-channel (email + iMessage): {cross_channel_count}")

    # Sort by reliability
    results.sort(key=lambda x: x['reliability'], reverse=True)

    # Top 20 most reliable
    print(f"\n{'='*70}")
    print(f"  TOP 20 MOST RELIABLE CONTACTS")
    print(f"{'='*70}")
    print(f"  {'Name':<35} {'Score':>6} {'Ghost':>10} {'Msgs':>6} {'iMsg':>5}")
    print(f"  {'-'*35} {'-'*6} {'-'*10} {'-'*6} {'-'*5}")
    for r in results[:20]:
        im = 'Y' if r['imessage_id'] else '-'
        print(f"  {(r['name'] or r['email'])[:35]:<35} {r['reliability']:>6.3f} {r['ghost_status']:>10} {r['total_messages']:>6} {im:>5}")

    # Top 20 least reliable (with significant volume >= 20)
    significant = [r for r in results if r['total_messages'] >= 20]
    significant.sort(key=lambda x: x['reliability'])
    print(f"\n{'='*70}")
    print(f"  TOP 20 LEAST RELIABLE (>= 20 messages)")
    print(f"{'='*70}")
    print(f"  {'Name':<35} {'Score':>6} {'Ghost':>10} {'Msgs':>6} {'Risk':>6}")
    print(f"  {'-'*35} {'-'*6} {'-'*10} {'-'*6} {'-'*6}")
    for r in significant[:20]:
        print(f"  {(r['name'] or r['email'])[:35]:<35} {r['reliability']:>6.3f} {r['ghost_status']:>10} {r['total_messages']:>6} {r['ghost_risk']:>6.2f}")

    # All ghosted contacts
    ghosted = [r for r in results if r['ghost_status'] == 'ghosted']
    ghosted.sort(key=lambda x: x['total_messages'], reverse=True)
    print(f"\n{'='*70}")
    print(f"  GHOSTED CONTACTS (> 365 days silent, >= 20 prior messages)")
    print(f"{'='*70}")
    print(f"  {'Name':<35} {'Msgs':>6} {'Last seen':>12}")
    print(f"  {'-'*35} {'-'*6} {'-'*12}")
    for r in ghosted:
        # Get last_seen from factors
        print(f"  {(r['name'] or r['email'])[:35]:<35} {r['total_messages']:>6}")
    print(f"\n  Total ghosted: {len(ghosted)}")

    # Ghost status distribution
    print(f"\n{'='*70}")
    print(f"  GHOST STATUS DISTRIBUTION")
    print(f"{'='*70}")
    for status in ['active', 'cooling', 'dormant', 'ghosted', 'low_volume', 'unknown']:
        count = ghost_counts.get(status, 0)
        pct = count / len(results) * 100 if results else 0
        bar = '#' * int(pct / 2)
        print(f"  {status:<12} {count:>6} ({pct:>5.1f}%)  {bar}")

    print(f"\n{'='*70}")
    print(f"  CROSS-CHANNEL PRESENCE")
    print(f"{'='*70}")
    print(f"  Contacts with both email + iMessage: {cross_channel_count}")
    print(f"  Percentage: {cross_channel_count / len(results) * 100:.1f}%")

    # List cross-channel contacts
    xc = [r for r in results if r['imessage_id']]
    xc.sort(key=lambda x: x['imessage_vol'], reverse=True)
    if xc:
        print(f"\n  {'Name':<35} {'Email':>6} {'iMsg':>6} {'Score':>6}")
        print(f"  {'-'*35} {'-'*6} {'-'*6} {'-'*6}")
        for r in xc[:30]:
            print(f"  {(r['name'] or r['email'])[:35]:<35} {r['total_messages']:>6} {r['imessage_vol']:>6} {r['reliability']:>6.3f}")

    conn.close()
    print(f"\n=== Done. Results written to {DB_PATH} ===")


if __name__ == "__main__":
    main()
