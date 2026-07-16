#!/usr/bin/env python3
"""
ISSUE SKELETON BUILDER
======================
Reconstructs the complete email trail for every magazine issue ever produced.
Scans MBOX files, detects issue references, groups emails by production window,
and outputs a structured skeleton per issue.

Each skeleton is the "digital mirror" for that issue — every observation
(email) that contributed to bringing the asset into existence.

Usage:
    python3 tools/build_issue_skeletons.py

Output:
    ~/issue_skeletons/          — one JSON file per issue
    ~/issue_skeletons/INDEX.json — master index of all issues
    ~/issue_skeletons/REPORT.md  — human-readable summary
"""

import os
import re
import json
import math
import hashlib
from datetime import datetime, timedelta
from collections import defaultdict, Counter
from email.utils import parsedate_to_datetime

# ---- CONFIG ----
MBOX_FILES = [
    (os.path.expanduser("~/jenny_tpo_email_archive/inbox.mbox"), "operator_a", "inbox"),
    (os.path.expanduser("~/jenny_tpo_email_archive/sent_messages.mbox"), "operator_a", "sent"),
    (os.path.expanduser("~/philippe_tpo_email_archive/inbox.mbox"), "operator_b", "inbox"),
    (os.path.expanduser("~/philippe_tpo_email_archive/sent_messages.mbox"), "operator_b", "sent"),
]

OUTPUT_DIR = os.path.expanduser("~/issue_skeletons")
os.makedirs(OUTPUT_DIR, exist_ok=True)

EMAIL_RE = re.compile(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}')

# ---- ISSUE DETECTION PATTERNS ----
ISSUE_PATTERNS = [
    # Explicit issue numbers
    (r'(?:issue|n[°o]\.?|num[eé]ro|numero)\s*(\d{1,3})', 'issue_number'),
    (r'#\s*(\d{1,3})(?:\s|$|[,\.])', 'issue_number'),
    # Season + year
    (r'(spring|summer|autumn|fall|winter|printemps|[eé]t[eé]|automne|hiver)\s*[\'"]?(\d{2,4})', 'season_year'),
    # Fashion codes
    (r'\b(SS|FW|PE|AH|PF|RE)\s*[\'"]?(\d{2,4})\b', 'fashion_code'),
    # Month + year in production context
    (r'\b(january|february|march|april|may|june|july|august|september|october|november|december|'
     r'janvier|f[eé]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre)'
     r'\s+(\d{4})\b', 'month_year'),
]

# ---- PRODUCTION PHASE KEYWORDS ----
PHASE_KEYWORDS = {
    'planning': re.compile(
        r'\b(planning|lineup|sommaire|sujet|story|stories|pitch|proposal|brief|briefing|'
        r'contenu|content|th[eè]me|concept|calendrier|schedule)\b', re.I),
    'photography': re.compile(
        r'\b(shoot|shooting|photo|photographie|s[eé]ance|studio|'
        r'photographe|photographer|lookbook|portrait|cover\s*shoot)\b', re.I),
    'editorial': re.compile(
        r'\b(article|texte|copy|r[eé]daction|relecture|correction|proofread|'
        r'interview|feature|story|reportage|chronique|rubrique)\b', re.I),
    'design': re.compile(
        r'\b(maquette|layout|mise\s*en\s*page|design|graphi|typo|'
        r'template|gabarit|format|couverture|cover)\b', re.I),
    'prepress': re.compile(
        r'\b(BAT|bon\s*[aà]\s*tirer|[eé]preuve|proof|flashage|'
        r'pr[eé]presse|prepress|calibra|color\s*proof|ozalid)\b', re.I),
    'print': re.compile(
        r'\b(imprim|print|tirage|impression|papier|paper|'
        r'imprimeur|printer|reliure|binding|bouclage)\b', re.I),
    'advertising': re.compile(
        r'\b(pub|publicit|annonce|annonceur|ad\b|insertion|'
        r'r[eé]servation|booking|m[eé]dia\s*kit|rate\s*card|'
        r'emplacement|placement|sponsor|partenariat)\b', re.I),
    'distribution': re.compile(
        r'\b(distribu|diffusion|envoi|livraison|kiosque|newsstand|'
        r'abonn|subscri|lancement|launch|sortie|release|parution)\b', re.I),
}

# ---- ATTACHMENT INDICATORS ----
ATTACHMENT_RE = re.compile(
    r'\b(pdf|jpeg|jpg|png|tiff?|indd|psd|ai|eps|doc|xlsx?|'
    r'wetransfer|dropbox|google\s*drive|hightail|filemail)\b', re.I)

# ---- FINANCIAL INDICATORS ----
FINANCIAL_RE = re.compile(
    r'(?:€|EUR|USD|\$|£|GBP|CHF)\s*[\d,.\s]+|'
    r'[\d,.\s]+\s*(?:€|EUR|USD|\$|£|GBP|CHF)|'
    r'\b(?:facture|invoice|devis|quote|bon\s*de\s*commande|purchase\s*order)\b', re.I)

# ---- URGENCY INDICATORS ----
URGENCY_RE = re.compile(
    r'\b(urgent|asap|deadline|date\s*limite|retard|delay|'
    r'rappel|reminder|relance|follow.?up|imp[eé]ratif)\b', re.I)


def normalize_season(match_type, groups):
    """Normalize issue references to a canonical key."""
    if match_type == 'issue_number':
        return f"ISSUE_{int(groups[0]):03d}"

    elif match_type == 'season_year':
        season_map = {
            'spring': 'SS', 'printemps': 'SS', 'été': 'SS', 'ete': 'SS', 'summer': 'SS',
            'autumn': 'FW', 'fall': 'FW', 'automne': 'FW', 'winter': 'FW', 'hiver': 'FW',
        }
        season = season_map.get(groups[0].lower(), groups[0].upper()[:2])
        year = groups[1] if len(groups[1]) == 4 else f"20{groups[1]}"
        return f"{season}_{year}"

    elif match_type == 'fashion_code':
        code = groups[0].upper()
        year = groups[1] if len(groups[1]) == 4 else f"20{groups[1]}"
        return f"{code}_{year}"

    elif match_type == 'month_year':
        month_map = {
            'january': '01', 'janvier': '01', 'february': '02', 'février': '02', 'fevrier': '02',
            'march': '03', 'mars': '03', 'april': '04', 'avril': '04',
            'may': '05', 'mai': '05', 'june': '06', 'juin': '06',
            'july': '07', 'juillet': '07', 'august': '08', 'août': '08', 'aout': '08',
            'september': '09', 'septembre': '09', 'october': '10', 'octobre': '10',
            'november': '11', 'novembre': '11', 'december': '12', 'décembre': '12', 'decembre': '12',
        }
        month = month_map.get(groups[0].lower(), '00')
        return f"{groups[1]}_{month}"

    return None


def detect_issues(subject):
    """Detect issue references in a subject line."""
    issues = []
    for pattern, match_type in ISSUE_PATTERNS:
        for m in re.finditer(pattern, subject, re.I):
            key = normalize_season(match_type, m.groups())
            if key:
                issues.append(key)
    return list(set(issues))


def detect_phases(subject):
    """Detect production phases from subject keywords."""
    phases = []
    for phase, regex in PHASE_KEYWORDS.items():
        if regex.search(subject):
            phases.append(phase)
    return phases


def parse_date(date_str):
    """Parse email date string to datetime."""
    if not date_str:
        return None
    try:
        return parsedate_to_datetime(date_str).replace(tzinfo=None)
    except Exception:
        pass
    # Fallback patterns
    for fmt in ['%a, %d %b %Y %H:%M:%S', '%d %b %Y %H:%M:%S', '%Y-%m-%d']:
        try:
            return datetime.strptime(date_str.strip()[:30], fmt)
        except Exception:
            continue
    return None


def hash_email(from_addr, date, subject):
    """Create a dedup hash for an email."""
    raw = f"{from_addr}|{date}|{subject}".encode('utf-8', errors='replace')
    return hashlib.sha256(raw).hexdigest()[:16]


def scan_mbox(path, operator, direction):
    """Scan an MBOX file line-by-line, extracting headers only."""
    emails = []
    current = {}
    last_header = None
    count = 0

    print(f"  Scanning {os.path.basename(path)} ({os.path.getsize(path)/1e9:.1f}GB)...")

    with open(path, 'rb') as f:
        for line in f:
            try:
                decoded = line.decode('utf-8', errors='replace')
            except:
                continue

            # New message boundary
            if decoded.startswith('From ') and not decoded.startswith('From:'):
                if current.get('subject'):
                    current['operator'] = operator
                    current['direction'] = direction
                    emails.append(current)
                    count += 1
                    if count % 5000 == 0:
                        print(f"    {count} messages parsed...")
                current = {}
                last_header = None
                continue

            # Header continuation (folded line)
            if decoded[0:1] in (' ', '\t') and last_header and not current.get('_body'):
                if last_header == 'subject':
                    current['subject'] = current.get('subject', '') + ' ' + decoded.strip()
                continue

            dl = decoded.lower()

            # Subject
            if dl.startswith('subject:'):
                current['subject'] = decoded[8:].strip()
                last_header = 'subject'
            # Date
            elif dl.startswith('date:'):
                current['date_raw'] = decoded[5:].strip()
                last_header = 'date'
            # From
            elif dl.startswith('from:'):
                found = EMAIL_RE.findall(decoded)
                if found:
                    current['from'] = found[0].lower()
                last_header = 'from'
            # To
            elif dl.startswith('to:'):
                found = EMAIL_RE.findall(decoded)
                current['to'] = [e.lower() for e in found]
                last_header = 'to'
            # CC
            elif dl.startswith('cc:'):
                found = EMAIL_RE.findall(decoded)
                current['cc'] = [e.lower() for e in found]
                last_header = 'cc'
            # Content-Type (attachment detection)
            elif dl.startswith('content-type:') and 'attachment' in dl:
                current['has_attachment'] = True
            elif dl.startswith('content-disposition:') and 'attachment' in dl:
                current['has_attachment'] = True
            # Empty line = headers done
            elif decoded.strip() == '' and current.get('subject'):
                current['_body'] = True

    # Don't forget last message
    if current.get('subject'):
        current['operator'] = operator
        current['direction'] = direction
        emails.append(current)

    print(f"    Done: {len(emails)} messages")
    return emails


def build_skeletons(all_emails):
    """Group emails into issue skeletons."""

    # Phase 1: Tag every email
    tagged = []
    for email in all_emails:
        subject = email.get('subject', '')
        date = parse_date(email.get('date_raw', ''))

        record = {
            'hash': hash_email(email.get('from', ''), email.get('date_raw', ''), subject),
            'date': date,
            'date_str': date.strftime('%Y-%m-%d') if date else None,
            'month': date.strftime('%Y-%m') if date else None,
            'from_domain': email.get('from', '').split('@')[-1] if email.get('from') else None,
            'operator': email.get('operator'),
            'direction': email.get('direction'),
            'issues': detect_issues(subject),
            'phases': detect_phases(subject),
            'has_financial': bool(FINANCIAL_RE.search(subject)),
            'has_attachment_signal': bool(ATTACHMENT_RE.search(subject)),
            'has_urgency': bool(URGENCY_RE.search(subject)),
            'participant_count': len(set(
                [email.get('from', '')] +
                email.get('to', []) +
                email.get('cc', [])
            )),
            'participants_domains': list(set(
                [email.get('from', '').split('@')[-1]] +
                [e.split('@')[-1] for e in email.get('to', [])] +
                [e.split('@')[-1] for e in email.get('cc', [])]
            )),
            # Keep subject hash only (not the text) for dedup
            'subject_hash': hashlib.md5(subject.encode('utf-8', errors='replace')).hexdigest()[:8],
        }
        tagged.append(record)

    print(f"\nTagged {len(tagged)} emails")
    print(f"  With issue references: {sum(1 for t in tagged if t['issues'])}")
    print(f"  With production phases: {sum(1 for t in tagged if t['phases'])}")
    print(f"  With financial signals: {sum(1 for t in tagged if t['has_financial'])}")

    # Phase 2: Group by issue
    issue_emails = defaultdict(list)
    for record in tagged:
        for issue_key in record['issues']:
            issue_emails[issue_key].append(record)

    # Phase 3: Expand windows — for each issue, also capture
    # production-phase emails during the issue's production window
    # from the same participants
    issue_windows = {}
    for issue_key, emails in issue_emails.items():
        dates = [e['date'] for e in emails if e['date']]
        if not dates:
            continue
        window_start = min(dates) - timedelta(days=30)  # 30 days before first mention
        window_end = max(dates) + timedelta(days=14)    # 14 days after last mention

        # Collect all participant domains from explicitly tagged emails
        issue_domains = set()
        for e in emails:
            issue_domains.update(e['participants_domains'])

        issue_windows[issue_key] = {
            'start': window_start,
            'end': window_end,
            'domains': issue_domains,
        }

    # Phase 4: Pull in windowed production emails
    for record in tagged:
        if record['issues']:  # already tagged
            continue
        if not record['phases']:  # not production-related
            continue
        if not record['date']:
            continue

        for issue_key, window in issue_windows.items():
            if window['start'] <= record['date'] <= window['end']:
                # Check if any participant domain overlaps
                if set(record['participants_domains']) & window['domains']:
                    issue_emails[issue_key].append(record)
                    record['issues'].append(issue_key)  # mark as associated

    # Phase 5: Build skeleton objects
    skeletons = {}
    for issue_key, emails in sorted(issue_emails.items()):
        # Dedup by hash
        seen = set()
        unique = []
        for e in emails:
            if e['hash'] not in seen:
                seen.add(e['hash'])
                unique.append(e)

        dates = [e['date'] for e in unique if e['date']]
        if not dates:
            continue

        # Phase breakdown
        phase_counts = Counter()
        phase_dates = defaultdict(list)
        for e in unique:
            for p in e['phases']:
                phase_counts[p] += 1
                if e['date']:
                    phase_dates[p].append(e['date'])

        # Phase timeline
        phase_timeline = {}
        for phase, pdates in phase_dates.items():
            phase_timeline[phase] = {
                'first': min(pdates).strftime('%Y-%m-%d'),
                'last': max(pdates).strftime('%Y-%m-%d'),
                'count': phase_counts[phase],
                'duration_days': (max(pdates) - min(pdates)).days,
            }

        # All participant domains (anonymized count)
        all_domains = set()
        for e in unique:
            all_domains.update(e['participants_domains'])

        # Operator split
        op_a = sum(1 for e in unique if e['operator'] == 'operator_a')
        op_b = sum(1 for e in unique if e['operator'] == 'operator_b')

        # Direction split
        inbound = sum(1 for e in unique if e['direction'] == 'inbox')
        outbound = sum(1 for e in unique if e['direction'] == 'sent')

        skeleton = {
            'issue_key': issue_key,
            'email_count': len(unique),
            'first_email': min(dates).strftime('%Y-%m-%d'),
            'last_email': max(dates).strftime('%Y-%m-%d'),
            'production_span_days': (max(dates) - min(dates)).days,
            'unique_domains': len(all_domains),
            'phase_breakdown': dict(phase_counts),
            'phase_timeline': phase_timeline,
            'phases_detected': sorted(phase_counts.keys()),
            'financial_signals': sum(1 for e in unique if e['has_financial']),
            'attachment_signals': sum(1 for e in unique if e['has_attachment_signal']),
            'urgency_signals': sum(1 for e in unique if e['has_urgency']),
            'operator_a_emails': op_a,
            'operator_b_emails': op_b,
            'inbound_emails': inbound,
            'outbound_emails': outbound,
            'monthly_distribution': dict(Counter(
                e['month'] for e in unique if e['month']
            )),
        }

        skeletons[issue_key] = skeleton

    return skeletons, tagged


def write_output(skeletons, all_tagged):
    """Write skeleton files and reports."""

    # Individual skeleton JSONs
    for key, skel in skeletons.items():
        safe_key = key.replace('/', '-').replace(' ', '_')
        path = os.path.join(OUTPUT_DIR, f"{safe_key}.json")
        with open(path, 'w') as f:
            json.dump(skel, f, indent=2, default=str)

    # Master index
    index = {
        'generated': datetime.now().strftime('%Y-%m-%d %H:%M'),
        'total_issues': len(skeletons),
        'total_emails_scanned': len(all_tagged),
        'total_production_emails': sum(1 for t in all_tagged if t['phases']),
        'issues': {k: {
            'email_count': v['email_count'],
            'span_days': v['production_span_days'],
            'first': v['first_email'],
            'last': v['last_email'],
            'phases': v['phases_detected'],
            'domains': v['unique_domains'],
        } for k, v in sorted(skeletons.items())}
    }
    with open(os.path.join(OUTPUT_DIR, 'INDEX.json'), 'w') as f:
        json.dump(index, f, indent=2)

    # Human-readable report (anonymized)
    lines = []
    lines.append("# ISSUE SKELETON REPORT")
    lines.append(f"*Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}*\n")
    lines.append(f"Total emails scanned: {len(all_tagged):,}")
    lines.append(f"Production-related emails: {sum(1 for t in all_tagged if t['phases']):,}")
    lines.append(f"Issue-tagged emails: {sum(1 for t in all_tagged if t['issues']):,}")
    lines.append(f"Issues reconstructed: {len(skeletons)}")

    # Summary stats
    if skeletons:
        spans = [s['production_span_days'] for s in skeletons.values() if s['production_span_days'] > 0]
        counts = [s['email_count'] for s in skeletons.values()]
        domains = [s['unique_domains'] for s in skeletons.values()]

        lines.append(f"\n## Production Metrics\n")
        lines.append(f"| Metric | Min | Median | Mean | Max |")
        lines.append(f"|--------|-----|--------|------|-----|")
        for name, data in [("Span (days)", spans), ("Emails/issue", counts), ("Orgs/issue", domains)]:
            if data:
                sdata = sorted(data)
                med = sdata[len(sdata)//2]
                lines.append(f"| {name} | {min(data)} | {med} | {sum(data)//len(data)} | {max(data)} |")

    # Phase coverage
    lines.append(f"\n## Phase Coverage Across All Issues\n")
    lines.append(f"| Phase | Issues with phase | Total emails |")
    lines.append(f"|-------|------------------|-------------|")
    phase_totals = Counter()
    phase_issue_count = Counter()
    for skel in skeletons.values():
        for phase, count in skel['phase_breakdown'].items():
            phase_totals[phase] += count
            phase_issue_count[phase] += 1
    for phase in ['planning', 'photography', 'editorial', 'design', 'prepress', 'print', 'advertising', 'distribution']:
        lines.append(f"| {phase} | {phase_issue_count.get(phase, 0)} | {phase_totals.get(phase, 0)} |")

    # Year distribution
    lines.append(f"\n## Issues by Year\n")
    year_counts = Counter()
    for key in skeletons:
        # Extract year from key
        for y in re.findall(r'20\d{2}', key):
            year_counts[y] += 1
            break
    for year in sorted(year_counts):
        bar = '#' * year_counts[year]
        lines.append(f"  {year}: {year_counts[year]:3d} {bar}")

    # Top 20 issues by email volume
    lines.append(f"\n## Top 20 Issues by Email Volume\n")
    lines.append(f"| Issue | Emails | Span | Orgs | Phases | Financial | Urgent |")
    lines.append(f"|-------|--------|------|------|--------|-----------|--------|")
    for skel in sorted(skeletons.values(), key=lambda x: -x['email_count'])[:20]:
        phases_str = ', '.join(skel['phases_detected'])
        lines.append(
            f"| {skel['issue_key']} | {skel['email_count']} | {skel['production_span_days']}d | "
            f"{skel['unique_domains']} | {phases_str} | {skel['financial_signals']} | {skel['urgency_signals']} |"
        )

    # Operator split
    lines.append(f"\n## Operator Contribution\n")
    total_a = sum(s['operator_a_emails'] for s in skeletons.values())
    total_b = sum(s['operator_b_emails'] for s in skeletons.values())
    lines.append(f"Operator A: {total_a:,} emails across issues")
    lines.append(f"Operator B: {total_b:,} emails across issues")
    if total_a + total_b > 0:
        lines.append(f"Split: {total_a*100//(total_a+total_b)}% / {total_b*100//(total_a+total_b)}%")

    report = '\n'.join(lines)
    with open(os.path.join(OUTPUT_DIR, 'REPORT.md'), 'w') as f:
        f.write(report)

    print(f"\nOutput written to {OUTPUT_DIR}/")
    print(f"  {len(skeletons)} skeleton JSON files")
    print(f"  INDEX.json")
    print(f"  REPORT.md")


def main():
    print("=" * 60)
    print("ISSUE SKELETON BUILDER")
    print("=" * 60)

    # Scan all MBOX files
    all_emails = []
    for path, operator, direction in MBOX_FILES:
        if os.path.exists(path):
            emails = scan_mbox(path, operator, direction)
            all_emails.extend(emails)
        else:
            print(f"  MISSING: {path}")

    print(f"\nTotal emails collected: {len(all_emails):,}")

    # Build skeletons
    skeletons, tagged = build_skeletons(all_emails)

    # Write output
    write_output(skeletons, tagged)

    print("\nDone.")


if __name__ == '__main__':
    main()
