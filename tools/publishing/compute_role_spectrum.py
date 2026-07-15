#!/usr/bin/env python3
"""
COMPUTE ROLE SPECTRUM
=====================
For each person with production credits OR >= 50 total emails, compute a
multi-dimensional role profile combining:
  - Observed roles:  keyword matches in email subjects/body_preview
  - Cited roles:     masthead/page credits from magazine_pages
  - Platform roles:  Supabase profile lookup

The result is stored as JSON in person_profiles.role_spectrum.
"""

import sqlite3
import re
import os
import json
import urllib.request
import urllib.parse
import ssl
from collections import defaultdict, Counter

DB = os.path.expanduser('~/email_intelligence.db')

# ---- SUPABASE CONFIG ----
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://PROJECT_REF.supabase.co')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', 'SET_ME')

# ---- PRODUCTION PHASE KEYWORDS ----

PHASE_KEYWORDS = {
    'casting': [
        r'\bcast(?:ing)?\b', r'\bmodel\b', r'\bmannequin\b',
        r'\bbooking\s*model\b', r'\bagenc[ey]\b',
    ],
    'photography': [
        r'\bshoot(?:ing)?\b', r'\bphoto\b', r'\bs[ée]ance\b',
        r'\bstudio\b', r'\bphotographe?\b', r'\blookbook\b',
        r'\bportrait\b', r'\bselects?\b',
    ],
    'editorial': [
        r'\barticle\b', r'\btexte?\b', r'\bcopy\b',
        r'\br[ée]daction\b', r'\brelecture\b', r'\bcorrection\b',
        r'\binterview\b', r'\bfeature\b',
    ],
    'design': [
        r'\bmaquette\b', r'\blayout\b', r'\bmise\s*en\s*page\b',
        r'\bdesign\b', r'\bgraphi', r'\btypo\b',
        r'\btemplate\b', r'\bcouverture\b', r'\bcover\b',
    ],
    'prepress': [
        r'\bBAT\b', r'\bbon\s*[àa]\s*tirer\b', r'\b[ée]preuve\b',
        r'\bproof\b', r'\bpr[ée]presse\b', r'\bcalibra',
        r'\bozalid\b',
    ],
    'print': [
        r'\bimprim', r'\bprint\b', r'\btirage\b',
        r'\bimpression\b', r'\bpapier\b', r'\bimprimeur\b',
    ],
    'production': [
        r'\bcall\s*sheet\b', r'\bschedule\b', r'\blogistic',
        r'\bplanning\b', r'\bretroplanning\b', r'\bcalendrier\b',
    ],
    'advertising': [
        r'\bpub\b', r'\bpublicit', r'\bannonce\b',
        r'\binsertion\b', r'\bbooking\b', r'\bm[ée]dia\s*kit\b',
        r'\brate\s*card\b', r'\bsponsor',
    ],
    'art_direction': [
        r'\bdirection\s*artistique\b', r'\bcreative\s*director\b',
        r'\bart\s*direction\b', r'\bDA\b',
    ],
    'styling': [
        r'\bstyl', r'\bfashion\s*editor\b',
        r'\bfashion\s*director\b', r'\blook\b',
    ],
}

# Compile all patterns per phase
PHASE_PATTERNS = {}
for phase, pats in PHASE_KEYWORDS.items():
    PHASE_PATTERNS[phase] = re.compile('|'.join(pats), re.I)


def add_column_if_missing(conn):
    """Add role_spectrum column to person_profiles if not present."""
    c = conn.cursor()
    c.execute("SELECT name FROM pragma_table_info('person_profiles') WHERE name='role_spectrum'")
    if not c.fetchone():
        c.execute("ALTER TABLE person_profiles ADD COLUMN role_spectrum TEXT")
        conn.commit()
        print("[+] Added role_spectrum column to person_profiles")
    else:
        print("[.] role_spectrum column already exists")


def get_candidates(conn):
    """Return list of (email, name) for people with production credits OR >= 50 total emails."""
    c = conn.cursor()
    c.execute("""
        SELECT email, name, COALESCE(credit_count, 0) as cc,
               COALESCE(total_sent,0) + COALESCE(total_received,0) as total
        FROM person_profiles
        WHERE COALESCE(credit_count, 0) > 0
           OR (COALESCE(total_sent,0) + COALESCE(total_received,0)) >= 50
    """)
    rows = c.fetchall()
    print(f"[.] Found {len(rows)} candidate people (credits>0 or emails>=50)")
    return [(r[0], r[1], r[2], r[3]) for r in rows]


# ---- Priority list ----
# Comma-separated addresses to process first (personal contacts — kept out of
# the repo)
PRIORITY_EMAILS = [
    a.strip().lower()
    for a in os.environ.get("PUBLISHING_PRIORITY_EMAILS", "").split(",")
    if a.strip()
]


def compute_observed_roles(conn, email):
    """Count how many emails for this person match each production phase keyword."""
    c = conn.cursor()
    # Get all emails where person is sender or recipient
    c.execute("""
        SELECT subject, body_preview FROM email_observations
        WHERE from_email = ?
           OR to_emails LIKE ?
           OR cc_emails LIKE ?
    """, (email, f'%{email}%', f'%{email}%'))
    rows = c.fetchall()
    if not rows:
        return {}, 0

    # Strip MIME headers from body_preview to avoid false positives
    # (e.g. "Content-Type: text/plain" matching editorial keyword "text")
    mime_strip = re.compile(r'Content-Type:.*?(?:\r?\n|$)|--[0-9a-f]{20,}', re.I)

    phase_counts = Counter()
    matched_total = 0

    for subject, body_preview in rows:
        clean_body = mime_strip.sub('', body_preview) if body_preview else ''
        text = (subject or '') + ' ' + clean_body
        matched_any = False
        for phase, pattern in PHASE_PATTERNS.items():
            if pattern.search(text):
                phase_counts[phase] += 1
                matched_any = True
        if matched_any:
            matched_total += 1

    if matched_total == 0:
        return {}, len(rows)

    # Convert to percentages
    observed = {}
    for phase, count in phase_counts.most_common():
        observed[phase] = {
            'count': count,
            'pct': round(100.0 * count / len(rows), 1),
        }
    return observed, len(rows)


def compute_cited_roles(conn, name):
    """Find all roles cited in magazine_pages for this person."""
    if not name:
        return []
    c = conn.cursor()
    c.execute("SELECT page_number, person_names, page_type, publication, issue_number FROM magazine_pages WHERE person_names LIKE ?", (f'%{name}%',))
    rows = c.fetchall()
    if not rows:
        # Try case-insensitive
        c.execute("SELECT page_number, person_names, page_type, publication, issue_number FROM magazine_pages WHERE person_names LIKE ?", (f'%{name.upper()}%',))
        rows = c.fetchall()
    if not rows and name and ' ' in name:
        # Try last name only
        last = name.split()[-1]
        c.execute("SELECT page_number, person_names, page_type, publication, issue_number FROM magazine_pages WHERE person_names LIKE ?", (f'%{last}%',))
        rows = c.fetchall()

    cited = []
    seen = set()
    for page_num, person_names_json, page_type, pub, issue in rows:
        try:
            entries = json.loads(person_names_json)
        except (json.JSONDecodeError, TypeError):
            continue
        for entry in entries:
            ename = entry.get('name', '')
            erole = entry.get('role', '')
            # Match name (case-insensitive)
            if name and name.lower() in ename.lower():
                key = (erole, page_type, pub, issue)
                if key not in seen:
                    seen.add(key)
                    cited.append({
                        'role': erole,
                        'page_type': page_type,
                        'page': page_num,
                        'publication': pub,
                        'issue': issue,
                    })
    return cited


def lookup_supabase_profile(name):
    """Check Supabase profiles for this person."""
    if not name or len(name) < 3:
        return None
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        url = (
            f"{SUPABASE_URL}/rest/v1/profiles"
            f"?full_name=ilike.*{urllib.parse.quote(name)}*"
            f"&select=id,full_name,role,email"
        )
        req = urllib.request.Request(url, headers={
            'apikey': SUPABASE_KEY,
            'Authorization': f'Bearer {SUPABASE_KEY}',
            'Content-Type': 'application/json',
        })
        resp = urllib.request.urlopen(req, timeout=10, context=ctx)
        data = json.loads(resp.read().decode())
        if data:
            return [{'full_name': d.get('full_name'), 'role': d.get('role'), 'email': d.get('email')} for d in data]
    except Exception as e:
        pass  # Supabase lookup is best-effort
    return None


def build_role_spectrum(conn, email, name, priority=False):
    """Build the full role_spectrum JSON for one person."""
    observed, total_emails = compute_observed_roles(conn, email)
    cited = compute_cited_roles(conn, name)

    platform = None
    if priority:
        platform = lookup_supabase_profile(name)

    spectrum = {
        'total_emails_scanned': total_emails,
        'observed': observed,
        'cited': cited,
    }
    if platform:
        spectrum['platform'] = platform

    # Derive a summary: top 3 observed phases + distinct cited roles
    top_observed = sorted(observed.items(), key=lambda x: -x[1]['count'])[:3]
    cited_roles = list({c['role'] for c in cited if c.get('role')})

    spectrum['summary'] = {
        'top_observed_phases': [p for p, _ in top_observed],
        'cited_roles': cited_roles,
    }

    return spectrum


def main():
    conn = sqlite3.connect(DB)
    add_column_if_missing(conn)

    candidates = get_candidates(conn)

    # Separate priority from rest
    priority_set = set(PRIORITY_EMAILS)
    priority_candidates = [c for c in candidates if c[0] in priority_set]
    other_candidates = [c for c in candidates if c[0] not in priority_set]

    # Sort others by total email volume descending
    other_candidates.sort(key=lambda x: -x[3])

    all_ordered = priority_candidates + other_candidates
    print(f"[.] Processing {len(priority_candidates)} priority + {len(other_candidates)} others = {len(all_ordered)} total")

    updated = 0
    c = conn.cursor()

    for i, (email, name, cc, total) in enumerate(all_ordered):
        is_priority = email in priority_set
        spectrum = build_role_spectrum(conn, email, name, priority=is_priority)

        spectrum_json = json.dumps(spectrum, ensure_ascii=False)
        c.execute("UPDATE person_profiles SET role_spectrum = ? WHERE email = ?", (spectrum_json, email))
        updated += 1

        if is_priority or i < 20:
            obs_summary = ', '.join(f"{p}({d['count']})" for p, d in sorted(spectrum['observed'].items(), key=lambda x: -x[1]['count'])[:4])
            cited_summary = ', '.join(spectrum['summary']['cited_roles'][:3]) or '(none)'
            print(f"  [{email}] {name}")
            print(f"    observed: {obs_summary or '(none)'}")
            print(f"    cited:    {cited_summary}")
            if spectrum.get('platform'):
                print(f"    platform: {spectrum['platform']}")

        if updated % 200 == 0:
            conn.commit()
            print(f"  ... {updated}/{len(all_ordered)} processed")

    conn.commit()
    print(f"\n[+] Updated role_spectrum for {updated} people")

    # ---- REPORT: top 20 by email volume, showing cited vs observed discrepancies ----
    print("\n" + "=" * 80)
    print("ROLE SPECTRUM REPORT — Top 20 by email volume")
    print("=" * 80)

    c.execute("""
        SELECT email, name, role_spectrum, professional_title,
               COALESCE(total_sent,0) + COALESCE(total_received,0) as total
        FROM person_profiles
        WHERE role_spectrum IS NOT NULL
        ORDER BY total DESC
        LIMIT 20
    """)

    for email, name, rs_json, prof_title, total in c.fetchall():
        rs = json.loads(rs_json)
        obs = rs.get('observed', {})
        cited = rs.get('summary', {}).get('cited_roles', [])
        top_obs = sorted(obs.items(), key=lambda x: -x[1]['count'])[:3]

        print(f"\n{name} <{email}>  ({total} emails)")
        print(f"  Auto-classified title: {prof_title or '(none)'}")
        print(f"  Cited (masthead/pages): {', '.join(cited) if cited else '(none)'}")
        obs_str = ', '.join(f"{p} {d['pct']}%" for p, d in top_obs)
        print(f"  Observed phases:       {obs_str or '(none)'}")

        # Flag discrepancies
        cited_lower = set(c.lower() for c in cited)
        obs_phases = set(p for p, _ in top_obs)

        # Map cited roles to expected phases
        role_phase_map = {
            'photographer': 'photography',
            'fashion editor': 'styling',
            'fashion director': 'styling',
            'copy editor': 'editorial',
            'creative director': 'art_direction',
            'editor-in-chief': 'editorial',
            'digital manager': 'production',
            'publisher': 'production',
            'editorial director': 'editorial',
            'graphic designer': 'design',
            'art director': 'art_direction',
            'stylist': 'styling',
            'author': 'editorial',
        }
        expected_phases = set()
        for cr in cited_lower:
            mapped = role_phase_map.get(cr)
            if mapped:
                expected_phases.add(mapped)

        if expected_phases and not expected_phases.intersection(obs_phases):
            print(f"  ** DISCREPANCY: cited roles suggest {expected_phases} but top observed are {obs_phases}")

    conn.close()
    print("\n[+] Done.")


if __name__ == '__main__':
    main()
