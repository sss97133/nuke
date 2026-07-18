#!/usr/bin/env python3
"""
REBUILD PRODUCTION CREDITS
==========================
Scans email_observations for all publication-matching emails,
assigns one credit per person x publication (and per-issue where detectable),
based on dominant production phase keywords in subject lines.
"""

import sqlite3
import re
import os
from collections import defaultdict, Counter

DB = os.path.expanduser('~/email_intelligence.db')

# ---- PUBLICATION DEFINITIONS (from build_publication_map.py) ----

PUBLICATIONS = {
    'lofficiel_stbarth': {
        'name': "L'Officiel St Barth",
        'match': re.compile(
            r"l.officiel\s*(st\.?\s*barth|sbh|saint.barth)|"
            r"LOSB|LOSBH|"
            r"officiel\s*st\.?\s*barth|"
            r"ST\s*BARTH\s*(BOUCLAGE|bouclage)|"
            r"BOUCLAGE\s*(ST\s*BARTH|OFFICIEL\s*ST)|"
            r"L.OFFICIEL\s*SAINT.BARTH",
            re.I
        ),
        'issue_re': re.compile(
            r"(?:l.officiel|officiel|LOSB)\s*(?:st\.?\s*barth|sbh|saint.barth)\s*"
            r"(?:#|n[°o]\.?\s*|num[eé]ro\s*|issue\s*)?(\d{1,2})\b",
            re.I
        ),
        'type': 'annual_magazine',
    },
    'lofficiel_riviera': {
        'name': "L'Officiel Riviera",
        'match': re.compile(r"l.officiel\s*riviera|officiel\s*riviera|BOUCLAGE\s*OFFICIEL\s*RIVIERA|RIVIERA\s*/?\s*BOUCLAGE", re.I),
        'issue_re': None,
        'type': 'annual_magazine',
    },
    'lofficiel_art': {
        'name': "L'Officiel Art",
        'match': re.compile(r"l.officiel\s*art", re.I),
        'issue_re': re.compile(r"l.officiel\s*art\s*(?:#|n[°o]\.?\s*)?(\d{1,3})", re.I),
        'type': 'magazine',
    },
    'lofficiel_voyage': {
        'name': "L'Officiel Voyage",
        'match': re.compile(r"l.officiel\s*voyage", re.I),
        'issue_re': re.compile(r"l.officiel\s*voyage\s*(?:#|n[°o]\.?\s*)?(\d{1,3})", re.I),
        'type': 'magazine',
    },
    'smart_map': {
        'name': 'Smart Map St Barth',
        'match': re.compile(r"smart\s*map", re.I),
        'issue_re': re.compile(r"smart\s*map\s*(\d{4})", re.I),
        'type': 'annual_guide',
    },
    'each_other': {
        'name': 'Each x Other',
        'match': re.compile(r"each\s*x?\s*other|EXO|EachxOther|eachother", re.I),
        'issue_re': re.compile(r"(SS|FW|AW|PE|AH|PF|RE)\s*['\"]?(\d{2,4})", re.I),
        'type': 'fashion_collection',
    },
    'art_saint_barth': {
        'name': 'Art Saint Barth',
        'match': re.compile(r"art\s*saint\s*barth|\bASB\b", re.I),
        'issue_re': None,
        'type': 'gallery_operations',
    },
    'utopia': {
        'name': 'Utopia',
        'match': re.compile(r"ut[oö]pia(?!\s*launch)", re.I),
        'issue_re': None,
        'type': 'art_project',
    },
}

# ---- PRODUCTION PHASE KEYWORDS (expanded) ----

PHASE_RE = {
    'planning': re.compile(r"\b(planning|lineup|sommaire|sujet|brief|concept|calendrier|schedule|retroplanning)\b", re.I),
    'photography': re.compile(r"\b(shoot|shooting|photo|s[eé]ance|studio|photographe|lookbook|portrait)\b", re.I),
    'editorial': re.compile(r"\b(article|texte|copy|r[eé]daction|relecture|correction|interview|feature|r[eé]dactrice)\b", re.I),
    'design': re.compile(r"\b(maquette|layout|mise\s*en\s*page|design|graphi|typo|template|gabarit|couverture|cover)\b", re.I),
    'prepress': re.compile(r"\b(BAT|bon\s*[aà]\s*tirer|[eé]preuve|proof|pr[eé]presse|calibra|ozalid)\b", re.I),
    'print': re.compile(r"\b(imprim|print|tirage|impression|papier|imprimeur|reliure|binding)\b", re.I),
    'bouclage': re.compile(r"\b(bouclage|closing|deadline|date\s*limite)\b", re.I),
    'advertising': re.compile(r"\b(pub|publicit|annonce|annonceur|insertion|booking|m[eé]dia\s*kit|rate\s*card|sponsor)\b", re.I),
    'distribution': re.compile(r"\b(distribu|diffusion|envoi|livraison|kiosque|abonn|launch|parution|sortie)\b", re.I),
    'casting': re.compile(r"\b(cast|model|mannequin|booking\s*model)\b", re.I),
    'styling': re.compile(r"\b(styl|fashion\s*editor|fashion\s*director|look)\b", re.I),
    'production': re.compile(r"\b(production|call\s*sheet|crew|team)\b", re.I),
}


def classify_email(subject):
    """Return (publication_slug, issue_key) or (None, None)"""
    if not subject:
        return None, None
    for slug, pub in PUBLICATIONS.items():
        if pub['match'].search(subject):
            issue_key = None
            if pub.get('issue_re'):
                m = pub['issue_re'].search(subject)
                if m:
                    groups = m.groups()
                    if pub['type'] == 'fashion_collection':
                        season = groups[0].upper()
                        year = groups[1] if len(groups[1]) == 4 else f"20{groups[1]}"
                        issue_key = f"{season}_{year}"
                    else:
                        issue_key = f"#{groups[0]}"
            return slug, issue_key
    return None, None


def detect_phases(subject):
    """Return list of production phases found in subject."""
    if not subject:
        return []
    return [p for p, pat in PHASE_RE.items() if pat.search(subject)]


# ---- CONNECT ----
db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row

# ---- SCAN ALL EMAILS ----
print("Scanning email_observations for publication matches...")

# Per-person per-publication accumulator
# key: (email, slug) -> {name, dates, subjects_phases, email_count, financial_count}
person_pub = defaultdict(lambda: {
    'name': '',
    'dates': [],
    'phase_counts': Counter(),
    'email_count': 0,
    'financial_count': 0,
})

# Per-person per-publication per-issue accumulator
# key: (email, slug, issue_key) -> same structure
person_pub_issue = defaultdict(lambda: {
    'name': '',
    'dates': [],
    'phase_counts': Counter(),
    'email_count': 0,
    'financial_count': 0,
})

total = 0
matched = 0

for r in db.execute("""
    SELECT date, from_email, from_name, from_domain, subject_clean,
           has_financial_signal
    FROM email_observations
    WHERE subject_clean IS NOT NULL AND date IS NOT NULL
    ORDER BY date
"""):
    total += 1
    subject = r['subject_clean'] or ''
    slug, issue_key = classify_email(subject)

    if not slug:
        continue

    matched += 1
    email_addr = (r['from_email'] or '').strip().lower()
    if not email_addr:
        continue

    name = r['from_name'] or ''
    date_str = (r['date'] or '')[:10]
    phases = detect_phases(subject)
    financial = 1 if r['has_financial_signal'] else 0

    # Accumulate per person x publication
    key = (email_addr, slug)
    rec = person_pub[key]
    # Keep longest/most informative name
    if len(name) > len(rec['name']):
        rec['name'] = name
    rec['dates'].append(date_str)
    for p in phases:
        rec['phase_counts'][p] += 1
    rec['email_count'] += 1
    rec['financial_count'] += financial

    # Accumulate per person x publication x issue (if issue detected)
    if issue_key:
        ikey = (email_addr, slug, issue_key)
        irec = person_pub_issue[ikey]
        if len(name) > len(irec['name']):
            irec['name'] = name
        irec['dates'].append(date_str)
        for p in phases:
            irec['phase_counts'][p] += 1
        irec['email_count'] += 1
        irec['financial_count'] += financial

print(f"Total emails scanned: {total:,}")
print(f"Matched to publications: {matched:,}")
print(f"Unique person x publication combos: {len(person_pub):,}")
print(f"Unique person x publication x issue combos: {len(person_pub_issue):,}")

# ---- DROP AND REBUILD TABLE ----
print("\nDropping and rebuilding production_credits table...")
cur = db.cursor()
cur.execute("DROP TABLE IF EXISTS production_credits")
cur.execute("""
CREATE TABLE production_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_email TEXT,
  person_name TEXT,
  professional_title TEXT,
  asset_type TEXT,
  asset_id TEXT,
  publication TEXT,
  role TEXT,
  date_start TEXT,
  date_end TEXT,
  email_count INTEGER,
  financial_signals INTEGER,
  confidence REAL,
  source TEXT DEFAULT 'email_archive'
)
""")

# ---- INSERT PERSON x PUBLICATION CREDITS ----
pub_credit_count = Counter()
person_credit_count = Counter()
total_credits = 0

for (email_addr, slug), rec in person_pub.items():
    pub_name = PUBLICATIONS[slug]['name']
    pub_type = PUBLICATIONS[slug]['type']

    # Determine dominant role
    if rec['phase_counts']:
        role = rec['phase_counts'].most_common(1)[0][0]
    else:
        role = 'general'

    dates = sorted(d for d in rec['dates'] if d)
    date_start = dates[0] if dates else ''
    date_end = dates[-1] if dates else ''

    # Confidence based on email count
    ec = rec['email_count']
    if ec >= 20:
        confidence = 0.95
    elif ec >= 10:
        confidence = 0.85
    elif ec >= 5:
        confidence = 0.75
    elif ec >= 2:
        confidence = 0.60
    else:
        confidence = 0.40

    cur.execute("""
        INSERT INTO production_credits
        (person_email, person_name, professional_title, asset_type, asset_id,
         publication, role, date_start, date_end, email_count, financial_signals,
         confidence, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'email_archive')
    """, (
        email_addr,
        rec['name'],
        None,  # professional_title - not determined here
        pub_type,
        slug,
        pub_name,
        role,
        date_start,
        date_end,
        rec['email_count'],
        rec['financial_count'],
        confidence,
    ))

    pub_credit_count[pub_name] += 1
    person_credit_count[email_addr] += 1
    total_credits += 1

# ---- INSERT PERSON x PUBLICATION x ISSUE CREDITS ----
issue_credits = 0

for (email_addr, slug, issue_key), rec in person_pub_issue.items():
    pub_name = PUBLICATIONS[slug]['name']
    pub_type = PUBLICATIONS[slug]['type']

    # Determine dominant role
    if rec['phase_counts']:
        role = rec['phase_counts'].most_common(1)[0][0]
    else:
        role = 'general'

    dates = sorted(d for d in rec['dates'] if d)
    date_start = dates[0] if dates else ''
    date_end = dates[-1] if dates else ''

    ec = rec['email_count']
    if ec >= 10:
        confidence = 0.90
    elif ec >= 5:
        confidence = 0.80
    elif ec >= 2:
        confidence = 0.65
    else:
        confidence = 0.45

    # asset_id = slug/issue_key for issue-level credits
    asset_id = f"{slug}/{issue_key}"

    cur.execute("""
        INSERT INTO production_credits
        (person_email, person_name, professional_title, asset_type, asset_id,
         publication, role, date_start, date_end, email_count, financial_signals,
         confidence, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'email_archive')
    """, (
        email_addr,
        rec['name'],
        None,
        pub_type + '_issue',
        asset_id,
        pub_name,
        role,
        date_start,
        date_end,
        rec['email_count'],
        rec['financial_count'],
        confidence,
    ))

    person_credit_count[email_addr] += 1
    issue_credits += 1
    total_credits += 1

db.commit()

# ---- SUMMARY ----
print(f"\n{'='*70}")
print(f"PRODUCTION CREDITS REBUILD COMPLETE")
print(f"{'='*70}")
print(f"\nTotal credits inserted: {total_credits:,}")
print(f"  Publication-level credits: {total_credits - issue_credits:,}")
print(f"  Issue-level credits: {issue_credits:,}")
print(f"\nPrevious count: 434")
print(f"New count: {total_credits:,}")

print(f"\n--- Credits per publication ---")
for pub_name, count in sorted(pub_credit_count.items(), key=lambda x: -x[1]):
    print(f"  {pub_name:30s}: {count:,}")

print(f"\n--- Top 20 people by credit count ---")
for email_addr, count in person_credit_count.most_common(20):
    # Get their name from any of their records
    name = ''
    for (e, s), rec in person_pub.items():
        if e == email_addr:
            name = rec['name']
            break
    print(f"  {email_addr:45s} {name:30s} {count:4d} credits")

# Verify
verify = db.execute("SELECT COUNT(*) FROM production_credits").fetchone()[0]
print(f"\nVerification: {verify:,} rows in production_credits table")

db.close()
print("Done.")
