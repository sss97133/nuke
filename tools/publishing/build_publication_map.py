#!/usr/bin/env python3
"""
PUBLICATION MAP BUILDER
=======================
Identifies every distinct publication from the email archive,
maps each issue with its production timeline, and cross-references
with bouclage (closing) dates, financial signals, and participants.

This replaces the broken issue_skeletons which couldn't tell
publications apart.
"""

import sqlite3
import json
import re
import os
from collections import defaultdict, Counter
from datetime import datetime

DB = os.path.expanduser('~/email_intelligence.db')
OUT = os.path.expanduser('~/publication_map')
os.makedirs(OUT, exist_ok=True)

db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row


# ---- PUBLICATION DEFINITIONS ----
# Each publication has a name, subject patterns to match, and a bouclage pattern

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

# Production phase keywords
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
}


def detect_phases(subject):
    return [p for p, pat in PHASE_RE.items() if pat.search(subject)]


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


# ---- SCAN ALL EMAILS ----
print("Scanning email_observations...")

pub_emails = defaultdict(list)  # slug -> list of email records
pub_issue_emails = defaultdict(lambda: defaultdict(list))  # slug -> issue_key -> emails
unmatched_bouclage = []

total = 0
matched = 0

for r in db.execute("""
    SELECT date, from_email, from_domain, from_name, subject_clean, source_account,
           has_financial_signal, has_urgency, recipient_count,
           to_emails, cc_emails, body_preview
    FROM email_observations
    WHERE subject_clean IS NOT NULL AND date IS NOT NULL
    ORDER BY date
"""):
    total += 1
    subject = r['subject_clean'] or ''
    slug, issue_key = classify_email(subject)

    if slug:
        matched += 1
        record = {
            'date': r['date'][:10] if r['date'] else '',
            'month': r['date'][:7] if r['date'] else '',
            'from': r['from_email'],
            'from_domain': r['from_domain'],
            'from_name': r['from_name'] or '',
            'subject': subject[:100],
            'account': r['source_account'],
            'financial': bool(r['has_financial_signal']),
            'urgency': bool(r['has_urgency']),
            'recipients': r['recipient_count'] or 1,
            'phases': detect_phases(subject),
            'issue_key': issue_key,
        }
        pub_emails[slug].append(record)
        if issue_key:
            pub_issue_emails[slug][issue_key].append(record)

    # Track bouclage emails specifically
    if 'bouclage' in subject.lower():
        if not slug:
            unmatched_bouclage.append({
                'date': (r['date'] or '')[:10],
                'subject': subject[:80],
                'account': r['source_account'],
            })

print(f"Total emails: {total:,}")
print(f"Matched to publication: {matched:,}")
print(f"Unmatched bouclage: {len(unmatched_bouclage)}")


# ---- BUILD PUBLICATION PROFILES ----
publications = {}

for slug, emails in pub_emails.items():
    pub = PUBLICATIONS[slug]
    dates = [e['date'] for e in emails if e['date']]
    domains = set(e['from_domain'] for e in emails)
    people = set(e['from'] for e in emails)
    accounts = Counter(e['account'] for e in emails)
    monthly = Counter(e['month'] for e in emails)
    phases = Counter()
    for e in emails:
        for p in e['phases']:
            phases[p] += 1

    bouclage_dates = sorted(set(
        e['date'] for e in emails if 'bouclage' in ' '.join(e['phases'])
    ))

    financial_emails = [e for e in emails if e['financial']]

    # Issue breakdown
    issue_map = {}
    for issue_key, issue_emails in pub_issue_emails[slug].items():
        idates = [e['date'] for e in issue_emails if e['date']]
        idomains = set(e['from_domain'] for e in issue_emails)
        ifinancial = sum(1 for e in issue_emails if e['financial'])
        iphases = Counter()
        for e in issue_emails:
            for p in e['phases']:
                iphases[p] += 1

        ibouclage = sorted(set(
            e['date'] for e in issue_emails if 'bouclage' in ' '.join(e['phases'])
        ))

        issue_map[issue_key] = {
            'key': issue_key,
            'email_count': len(issue_emails),
            'first_date': min(idates) if idates else '',
            'last_date': max(idates) if idates else '',
            'domains': len(idomains),
            'financial': ifinancial,
            'bouclage_dates': ibouclage,
            'phases': dict(iphases),
            'span_days': (datetime.strptime(max(idates), '%Y-%m-%d') -
                         datetime.strptime(min(idates), '%Y-%m-%d')).days if len(idates) >= 2 else 0,
        }

    publications[slug] = {
        'slug': slug,
        'name': pub['name'],
        'type': pub['type'],
        'total_emails': len(emails),
        'first_date': min(dates) if dates else '',
        'last_date': max(dates) if dates else '',
        'span_years': round((datetime.strptime(max(dates), '%Y-%m-%d') -
                            datetime.strptime(min(dates), '%Y-%m-%d')).days / 365.25, 1) if len(dates) >= 2 else 0,
        'unique_domains': len(domains),
        'unique_people': len(people),
        'accounts': dict(accounts),
        'monthly_volume': dict(sorted(monthly.items())),
        'phases': dict(phases.most_common()),
        'bouclage_dates': bouclage_dates,
        'bouclage_count': len(bouclage_dates),
        'financial_emails': len(financial_emails),
        'issues': {k: v for k, v in sorted(issue_map.items(),
                   key=lambda x: x[1].get('first_date', ''))},
        'issue_count': len(issue_map),
    }


# ---- WRITE OUTPUT ----

# 1. Master publication index
with open(os.path.join(OUT, 'INDEX.json'), 'w') as f:
    json.dump(publications, f, indent=2, default=str)

# 2. Individual publication files
for slug, pub in publications.items():
    with open(os.path.join(OUT, f'{slug}.json'), 'w') as f:
        json.dump(pub, f, indent=2, default=str)

# 3. Human-readable report
lines = []
lines.append("# PUBLICATION MAP")
lines.append(f"*Generated from {total:,} emails | {matched:,} matched to publications*\n")

for slug in sorted(publications, key=lambda s: -publications[s]['total_emails']):
    pub = publications[slug]
    lines.append(f"\n{'='*70}")
    lines.append(f"## {pub['name']}")
    lines.append(f"Type: {pub['type']}")
    lines.append(f"Span: {pub['first_date']} to {pub['last_date']} ({pub['span_years']} years)")
    lines.append(f"Total emails: {pub['total_emails']:,}")
    lines.append(f"Unique people: {pub['unique_people']}")
    lines.append(f"Unique organizations: {pub['unique_domains']}")
    lines.append(f"Financial signals: {pub['financial_emails']}")
    lines.append(f"Bouclage events: {pub['bouclage_count']}")

    if pub['phases']:
        lines.append(f"\nProduction phases:")
        for phase, count in sorted(pub['phases'].items(), key=lambda x: -x[1]):
            bar = '#' * min(count // 10, 40)
            lines.append(f"  {phase:15s}: {count:5d}  {bar}")

    if pub['accounts']:
        lines.append(f"\nEmail accounts:")
        for acct, count in sorted(pub['accounts'].items(), key=lambda x: -x[1]):
            lines.append(f"  {acct:35s}: {count:,}")

    if pub['issues']:
        lines.append(f"\n### Issues ({pub['issue_count']})")
        lines.append(f"{'Key':12s} {'Emails':>7s} {'Orgs':>5s} {'Days':>5s} {'Fin':>4s} {'Period':25s} {'Bouclage':15s}")
        lines.append('-' * 80)
        for key, iss in sorted(pub['issues'].items(), key=lambda x: x[1].get('first_date', '')):
            bouclage_str = ', '.join(iss['bouclage_dates'][:3]) if iss['bouclage_dates'] else '-'
            lines.append(
                f"{key:12s} {iss['email_count']:7d} {iss['domains']:5d} {iss['span_days']:5d} "
                f"{iss['financial']:4d} {iss['first_date']:>10s} — {iss['last_date']:>10s}  {bouclage_str}"
            )

    if pub['bouclage_dates']:
        lines.append(f"\nBouclage timeline:")
        # Group by year
        by_year = defaultdict(list)
        for d in pub['bouclage_dates']:
            by_year[d[:4]].append(d)
        for year in sorted(by_year):
            dates = by_year[year]
            first = min(dates)
            last = max(dates)
            lines.append(f"  {year}: {first} — {last} ({len(dates)} emails)")

    # Monthly activity sparkline
    if pub['monthly_volume']:
        lines.append(f"\nMonthly activity:")
        months = sorted(pub['monthly_volume'].items())
        max_vol = max(v for _, v in months)
        for month, vol in months:
            bar = '#' * int(vol / max(max_vol, 1) * 40)
            if vol > max_vol * 0.3:  # Only show significant months
                lines.append(f"  {month}: {vol:4d}  {bar}")

report = '\n'.join(lines)
with open(os.path.join(OUT, 'REPORT.md'), 'w') as f:
    f.write(report)

# ---- PRINT SUMMARY ----
print(f"\n{'='*70}")
print("PUBLICATION MAP SUMMARY")
print(f"{'='*70}\n")

for slug in sorted(publications, key=lambda s: -publications[s]['total_emails']):
    pub = publications[slug]
    issues_str = f" | {pub['issue_count']} issues" if pub['issue_count'] else ""
    print(f"  {pub['name']:30s} | {pub['total_emails']:6,} emails | "
          f"{pub['unique_people']:4d} people | {pub['unique_domains']:4d} orgs | "
          f"{pub['span_years']:4.1f} yrs | {pub['bouclage_count']:3d} bouclages{issues_str}")

print(f"\nOutput: {OUT}/")
print(f"  INDEX.json — master publication data")
print(f"  REPORT.md — human-readable report")
print(f"  [slug].json — per-publication detail files")

db.close()
