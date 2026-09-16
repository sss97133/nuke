#!/usr/bin/env python3
"""
JSON API server for email_intelligence.db
Serves data to PUBLISHING_VIEWER.html at http://localhost:8888
"""

import json
import sqlite3
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

DB = os.path.expanduser('~/email_intelligence.db')

# Comma-separated domains owned by the archive operators (kept out of the repo)
OPERATOR_DOMAINS = tuple(
    d.strip().lower()
    for d in os.environ.get("PUBLISHING_OPERATOR_DOMAINS", "").split(",")
    if d.strip()
)

PUB_NAMES = {
    'lofficiel_stbarth': "L'Officiel St Barth",
    'lofficiel_riviera': "L'Officiel Riviera",
    'lofficiel_art': "L'Officiel Art",
    'lofficiel_voyage': "L'Officiel Voyage",
    'each_other': "Each x Other",
    'art_saint_barth': "Art Saint Barth",
    'utopia': "Utopia",
    'smart_map': "Smart Map St Barth",
}


def get_db():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    return db


def query(sql, params=()):
    db = get_db()
    try:
        rows = db.execute(sql, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        db.close()


def query_one(sql, params=()):
    rows = query(sql, params)
    return rows[0] if rows else None


# --- Alias resolution ---

def resolve_alias(email):
    """If email is an alias, return canonical. Otherwise return email."""
    row = query_one(
        "SELECT canonical_email FROM person_aliases WHERE alias_email = ?",
        (email,)
    )
    return row['canonical_email'] if row else email


def get_all_emails_for(canonical_email):
    """Return list of all emails (canonical + aliases) for a person."""
    aliases = query(
        "SELECT alias_email FROM person_aliases WHERE canonical_email = ?",
        (canonical_email,)
    )
    emails = [canonical_email] + [a['alias_email'] for a in aliases]
    return list(set(emails))


def email_where_clause(emails, prefix=''):
    """Build WHERE fragment matching any of the emails in from/to/cc."""
    if not emails:
        return '1=0', []
    from_parts = []
    like_parts = []
    params = []
    for e in emails:
        from_parts.append(f'{prefix}from_email = ?')
        like_parts.append(f'{prefix}to_emails LIKE ?')
        like_parts.append(f'{prefix}cc_emails LIKE ?')
        params.extend([e, f'%{e}%', f'%{e}%'])
    clause = '(' + ' OR '.join(from_parts + like_parts) + ')'
    return clause, params


# --- Sparkline helper ---

def monthly_sparkline_data(sql, params):
    """Return last 12 months of counts as array."""
    rows = query(sql, params)
    if not rows:
        return [0] * 12
    # Get last 12 entries
    counts = [r.get('emails', r.get('n', 0)) or 0 for r in rows]
    if len(counts) > 12:
        counts = counts[-12:]
    while len(counts) < 12:
        counts.insert(0, 0)
    return counts


# --- Endpoints ---

def get_stats():
    stats = {}
    queries = [
        ('emails', 'SELECT COUNT(*) as n FROM email_observations'),
        ('imessages', 'SELECT COUNT(*) as n FROM imessage_observations'),
        ('people', 'SELECT COUNT(*) as n FROM person_profiles WHERE is_noise = 0'),
        ('orgs', "SELECT COUNT(*) as n FROM org_profiles WHERE org_type = 'business'"),
        ('threads', 'SELECT COUNT(*) as n FROM threads'),
        ('aliases', 'SELECT COUNT(*) as n FROM person_aliases'),
        ('credits', 'SELECT COUNT(*) as n FROM production_credits'),
        ('publications', 'SELECT COUNT(DISTINCT publication_slug) as n FROM email_publication_match'),
        ('pages', 'SELECT COUNT(*) as n FROM magazine_pages'),
        ('ghosted', "SELECT COUNT(*) as n FROM person_profiles WHERE ghost_status = 'ghosted' AND is_noise = 0"),
        ('active', "SELECT COUNT(*) as n FROM person_profiles WHERE ghost_status = 'active' AND is_noise = 0"),
        ('financial_signals', 'SELECT COUNT(*) as n FROM email_observations WHERE has_financial_signal = 1'),
    ]
    for name, sql in queries:
        try:
            r = query(sql)
            stats[name] = r[0]['n'] if r else 0
        except Exception:
            stats[name] = 0
    return stats


def search_everything(q):
    q = q.strip()
    if not q or len(q) < 2:
        return []
    pattern = f'%{q}%'
    results = []

    # Orgs
    orgs = query("""
        SELECT domain, clean_name, inferred_name, total_emails, org_type,
               first_seen, last_seen, 'org' as result_type
        FROM org_profiles
        WHERE (clean_name LIKE ? OR inferred_name LIKE ? OR domain LIKE ?)
          AND org_type = 'business' AND total_emails >= 5
        ORDER BY total_emails DESC LIMIT 15
    """, (pattern, pattern, pattern))
    results.extend(orgs)

    # People
    people = query("""
        SELECT email, name, professional_title, domain,
               (total_sent + total_received) as total_emails,
               reliability_score, ghost_status, role_spectrum,
               'person' as result_type
        FROM person_profiles
        WHERE (name LIKE ? OR email LIKE ? OR professional_title LIKE ?)
          AND is_noise = 0
          AND (total_sent + total_received) >= 3
        ORDER BY (total_sent + total_received) DESC LIMIT 15
    """, (pattern, pattern, pattern))
    results.extend(people)

    # Threads/subjects
    subjects = query("""
        SELECT subject_clean, COUNT(*) as thread_count,
               MIN(date) as first_date, MAX(date) as last_date,
               GROUP_CONCAT(DISTINCT from_name) as people,
               'thread' as result_type
        FROM email_observations
        WHERE subject_clean LIKE ?
        GROUP BY subject_clean
        ORDER BY thread_count DESC LIMIT 10
    """, (pattern,))
    results.extend(subjects)

    return results


def get_org(domain):
    org = query_one("SELECT * FROM org_profiles WHERE domain = ?", (domain,))
    brand = domain.split('.')[0] if domain else ''

    monthly = query("""
        SELECT substr(date,1,7) as month, COUNT(*) as emails,
               COUNT(DISTINCT from_email) as people,
               SUM(has_financial_signal) as financial
        FROM email_observations
        WHERE from_domain = ? OR to_emails LIKE ? OR cc_emails LIKE ?
           OR subject_clean LIKE ?
        GROUP BY month ORDER BY month
    """, (domain, f'%{domain}%', f'%{domain}%', f'%{brand}%'))

    # People AT this org
    people_at = query("""
        SELECT e.from_email, e.from_name, COUNT(*) as emails,
               MIN(e.date) as first_seen, MAX(e.date) as last_seen,
               p.ghost_status, p.professional_title
        FROM email_observations e
        LEFT JOIN person_profiles p ON e.from_email = p.email
        WHERE e.from_domain = ?
        GROUP BY e.from_email
        ORDER BY emails DESC LIMIT 50
    """, (domain,))

    # Operator people in threads with this org
    op_domains_like = ' OR '.join(['from_domain = ?' for _ in OPERATOR_DOMAINS])
    people_operator = query(f"""
        SELECT from_email, from_name, from_domain, COUNT(*) as emails
        FROM email_observations
        WHERE ({op_domains_like})
          AND (to_emails LIKE ? OR cc_emails LIKE ? OR subject_clean LIKE ?)
        GROUP BY from_email
        ORDER BY emails DESC LIMIT 20
    """, (*OPERATOR_DOMAINS, f'%{domain}%', f'%{domain}%', f'%{brand}%'))

    financial = query("""
        SELECT date, from_name, from_email, subject_clean, financial_amounts
        FROM email_observations
        WHERE has_financial_signal = 1
          AND (from_domain = ? OR to_emails LIKE ? OR cc_emails LIKE ?
               OR subject_clean LIKE ?)
        ORDER BY date DESC
    """, (domain, f'%{domain}%', f'%{domain}%', f'%{brand}%'))

    subjects = query("""
        SELECT subject_clean, COUNT(*) as email_count,
               MIN(date) as first_date, MAX(date) as last_date
        FROM email_observations
        WHERE from_domain = ? OR to_emails LIKE ? OR cc_emails LIKE ?
        GROUP BY subject_clean
        ORDER BY email_count DESC LIMIT 50
    """, (domain, f'%{domain}%', f'%{domain}%'))

    return {
        'org': org,
        'monthly': monthly,
        'people_at_org': people_at,
        'people_operator': people_operator,
        'financial': financial,
        'subjects': subjects,
    }


def get_org_daily(domain):
    brand = domain.split('.')[0] if domain else ''
    return query("""
        SELECT date(date) as day, COUNT(*) as emails,
               COUNT(DISTINCT from_email) as people,
               SUM(has_financial_signal) as financial,
               GROUP_CONCAT(DISTINCT from_name) as names,
               GROUP_CONCAT(DISTINCT substr(subject_clean,1,80), ' | ') as subjects
        FROM email_observations
        WHERE from_domain = ?
           OR to_emails LIKE ?
           OR cc_emails LIKE ?
           OR subject_clean LIKE ?
        GROUP BY day ORDER BY day
    """, (domain, f'%{domain}%', f'%{domain}%', f'%{brand}%'))


def get_org_day(domain, day):
    brand = domain.split('.')[0] if domain else ''
    return query("""
        SELECT date, from_name, from_email, from_domain,
               to_emails, cc_emails, subject_clean,
               has_financial_signal, body_preview
        FROM email_observations
        WHERE (from_domain = ? OR to_emails LIKE ? OR cc_emails LIKE ?
               OR subject_clean LIKE ?)
          AND date(date) = ?
        ORDER BY date
    """, (domain, f'%{domain}%', f'%{domain}%', f'%{brand}%', day))


def get_org_timeline(domain, limit=100, offset=0):
    brand = domain.split('.')[0] if domain else ''
    rows = query("""
        SELECT date, from_name, from_email, from_domain,
               to_emails, subject_clean,
               has_financial_signal, body_preview
        FROM email_observations
        WHERE from_domain = ?
           OR to_emails LIKE ?
           OR cc_emails LIKE ?
           OR subject_clean LIKE ?
        ORDER BY date DESC
        LIMIT ? OFFSET ?
    """, (domain, f'%{domain}%', f'%{domain}%', f'%{brand}%', limit, offset))

    for r in rows:
        if r.get('has_financial_signal'):
            r['signal_type'] = 'financial'
        r['direction'] = 'sent' if r.get('from_domain') == domain else 'received'

    return rows


def get_person(email):
    canonical = resolve_alias(email)
    all_emails = get_all_emails_for(canonical)

    profile = query_one(
        "SELECT * FROM person_profiles WHERE email = ? AND is_noise = 0",
        (canonical,)
    )
    if not profile:
        # Try the original email
        profile = query_one(
            "SELECT * FROM person_profiles WHERE email = ? AND is_noise = 0",
            (email,)
        )
    if not profile:
        return {'profile': None}

    # Parse JSON fields
    for field in ('role_spectrum', 'reliability_factors', 'activity_pattern',
                  'stated_preferences', 'affiliations', 'source_accounts'):
        if profile.get(field) and isinstance(profile[field], str):
            try:
                profile[field] = json.loads(profile[field])
            except Exception:
                pass

    aliases = query(
        "SELECT * FROM person_aliases WHERE canonical_email = ?",
        (canonical,)
    )

    # Credits
    credits = query("""
        SELECT * FROM production_credits
        WHERE person_email IN ({})
        ORDER BY date_start DESC
    """.format(','.join('?' * len(all_emails))), all_emails)

    # iMessage
    imessage = query("""
        SELECT sender, COUNT(*) as msgs, MIN(date) as first_msg, MAX(date) as last_msg
        FROM imessage_observations
        WHERE sender IN ({})
        GROUP BY sender
    """.format(','.join('?' * len(all_emails))), all_emails)

    # Monthly activity (across all aliases)
    where_clause, params = email_where_clause(all_emails)
    monthly = query(f"""
        SELECT substr(date,1,7) as month, COUNT(*) as emails,
               SUM(CASE WHEN from_email IN ({','.join('?' * len(all_emails))}) THEN 1 ELSE 0 END) as sent,
               COUNT(*) - SUM(CASE WHEN from_email IN ({','.join('?' * len(all_emails))}) THEN 1 ELSE 0 END) as received
        FROM email_observations
        WHERE {where_clause}
        GROUP BY month ORDER BY month
    """, all_emails + all_emails + params)

    return {
        'profile': profile,
        'aliases': aliases,
        'credits': credits,
        'imessage': imessage,
        'monthly': monthly,
        'all_emails': all_emails,
    }


def get_person_daily(email):
    canonical = resolve_alias(email)
    all_emails = get_all_emails_for(canonical)
    where_clause, params = email_where_clause(all_emails)

    return query(f"""
        SELECT date(date) as day, COUNT(*) as emails,
               SUM(CASE WHEN from_email IN ({','.join('?' * len(all_emails))}) THEN 1 ELSE 0 END) as sent,
               COUNT(*) - SUM(CASE WHEN from_email IN ({','.join('?' * len(all_emails))}) THEN 1 ELSE 0 END) as received,
               SUM(has_financial_signal) as financial,
               GROUP_CONCAT(DISTINCT substr(subject_clean,1,60), ' | ') as subjects
        FROM email_observations
        WHERE {where_clause}
        GROUP BY day ORDER BY day
    """, all_emails + params)


def get_people():
    rows = query("""
        SELECT p.email, p.name, p.professional_title, p.domain,
               p.total_sent, p.total_received, p.first_seen, p.last_seen,
               p.active_months, p.reliability_score, p.ghost_status, p.ghost_risk,
               p.role_spectrum, p.is_operator,
               COALESCE(a.canonical_email, p.email) as canonical_email
        FROM person_profiles p
        LEFT JOIN person_aliases a ON p.email = a.alias_email
        WHERE p.is_noise = 0
          AND p.name IS NOT NULL AND p.name != ''
          AND (p.total_sent + p.total_received) >= 3
        ORDER BY (p.total_sent + p.total_received) DESC
    """)

    merged = {}
    for r in rows:
        key = r['canonical_email']
        if key not in merged:
            merged[key] = dict(r)
            merged[key]['alias_count'] = 1
            merged[key]['all_emails'] = [r['email']]
        else:
            m = merged[key]
            m['total_sent'] = (m['total_sent'] or 0) + (r['total_sent'] or 0)
            m['total_received'] = (m['total_received'] or 0) + (r['total_received'] or 0)
            m['alias_count'] += 1
            m['all_emails'].append(r['email'])
            if not m.get('name') and r.get('name'):
                m['name'] = r['name']
            if not m.get('professional_title') and r.get('professional_title'):
                m['professional_title'] = r['professional_title']
            if not m.get('reliability_score') and r.get('reliability_score'):
                m['reliability_score'] = r['reliability_score']
            if not m.get('ghost_status') and r.get('ghost_status'):
                m['ghost_status'] = r['ghost_status']
            if not m.get('role_spectrum') and r.get('role_spectrum'):
                m['role_spectrum'] = r['role_spectrum']
            if r.get('first_seen') and (not m.get('first_seen') or r['first_seen'] < m['first_seen']):
                m['first_seen'] = r['first_seen']
            if r.get('last_seen') and (not m.get('last_seen') or r['last_seen'] > m['last_seen']):
                m['last_seen'] = r['last_seen']

    result = sorted(merged.values(), key=lambda x: -((x.get('total_sent') or 0) + (x.get('total_received') or 0)))[:100]

    # Add sparkline data for each
    for p in result:
        sparkline = monthly_sparkline_data("""
            SELECT substr(date,1,7) as month, COUNT(*) as emails
            FROM email_observations
            WHERE from_email = ? OR to_emails LIKE ? OR cc_emails LIKE ?
            GROUP BY month ORDER BY month
        """, (p['email'], f'%{p["email"]}%', f'%{p["email"]}%'))
        p['sparkline'] = sparkline

    return result


def get_orgs():
    rows = query("""
        SELECT domain, clean_name, inferred_name, org_type, total_emails,
               contact_count, first_seen, last_seen, active_months,
               financial_signal_count, thread_count, relationship_health,
               parent_domain
        FROM org_profiles
        WHERE org_type = 'business' AND total_emails >= 5
        ORDER BY total_emails DESC
        LIMIT 100
    """)

    for o in rows:
        sparkline = monthly_sparkline_data("""
            SELECT substr(date,1,7) as month, COUNT(*) as emails
            FROM email_observations
            WHERE from_domain = ? OR to_emails LIKE ?
            GROUP BY month ORDER BY month
        """, (o['domain'], f'%{o["domain"]}%'))
        o['sparkline'] = sparkline

    return rows


def get_publications():
    # Get counts from email_publication_match
    pubs = query("""
        SELECT epm.publication_slug,
               COUNT(*) as email_count,
               COUNT(DISTINCT e.from_email) as unique_people,
               COUNT(DISTINCT e.from_domain) as unique_orgs
        FROM email_publication_match epm
        JOIN email_observations e ON e.rowid = epm.rowid_ref
        GROUP BY epm.publication_slug
        ORDER BY email_count DESC
    """)

    for p in pubs:
        p['name'] = PUB_NAMES.get(p['publication_slug'], p['publication_slug'])

    return pubs


def get_pages(publication, issue):
    return query("""
        SELECT * FROM magazine_pages
        WHERE publication = ? AND issue_number = ?
        ORDER BY page_number
    """, (publication, issue))


# --- HTTP Handler ---

class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        def p(name, default=''):
            return params.get(name, [default])[0]

        try:
            if path == '/api/stats':
                data = get_stats()
            elif path == '/api/search':
                data = search_everything(p('q'))
            elif path == '/api/org':
                data = get_org(p('domain'))
            elif path == '/api/org/daily':
                data = get_org_daily(p('domain'))
            elif path == '/api/org/day':
                data = get_org_day(p('domain'), p('day'))
            elif path == '/api/org/timeline':
                data = get_org_timeline(
                    p('domain'),
                    int(p('limit', '100')),
                    int(p('offset', '0'))
                )
            elif path == '/api/person':
                data = get_person(p('email'))
            elif path == '/api/person/daily':
                data = get_person_daily(p('email'))
            elif path == '/api/people':
                data = get_people()
            elif path == '/api/orgs':
                data = get_orgs()
            elif path == '/api/publications':
                data = get_publications()
            elif path == '/api/pages':
                data = get_pages(p('publication'), p('issue'))
            else:
                data = {
                    'error': 'Unknown endpoint',
                    'endpoints': [
                        '/api/stats', '/api/search?q=X',
                        '/api/org?domain=X', '/api/org/daily?domain=X',
                        '/api/org/day?domain=X&day=YYYY-MM-DD',
                        '/api/org/timeline?domain=X&limit=100&offset=0',
                        '/api/person?email=X', '/api/person/daily?email=X',
                        '/api/people', '/api/orgs',
                        '/api/publications',
                        '/api/pages?publication=X&issue=Y',
                    ]
                }

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(data, default=str).encode())

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())
            import traceback
            traceback.print_exc()

    def log_message(self, format, *args):
        pass


if __name__ == '__main__':
    port = 8888
    print(f'Publishing Intelligence API')
    print(f'http://localhost:{port}')
    print()
    print(f'Endpoints:')
    print(f'  GET /api/stats                              Dashboard counts')
    print(f'  GET /api/search?q=X                         Search orgs/people/threads')
    print(f'  GET /api/org?domain=X                       Full org analysis')
    print(f'  GET /api/org/daily?domain=X                 Day-level org data')
    print(f'  GET /api/org/day?domain=X&day=YYYY-MM-DD    Single day detail')
    print(f'  GET /api/org/timeline?domain=X&limit=N      Interleaved timeline')
    print(f'  GET /api/person?email=X                     Full person analysis')
    print(f'  GET /api/person/daily?email=X               Day-level person data')
    print(f'  GET /api/people                             Top 100 people')
    print(f'  GET /api/orgs                               Top 100 orgs')
    print(f'  GET /api/publications                       Publication match counts')
    print(f'  GET /api/pages?publication=X&issue=Y        Magazine pages')
    print()
    print(f'Database: {DB}')
    print(f'Serving on port {port}...')

    HTTPServer(('', port), Handler).serve_forever()
