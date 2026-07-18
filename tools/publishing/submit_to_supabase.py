#!/usr/bin/env python3
"""
Submit structured data from email_intelligence.db to Nuke Supabase instance.

Privacy rules enforced:
- NO raw email addresses
- NO message bodies or phone numbers
- Only professional names, roles, publication data, org relationships

Actual Supabase schema (discovered via OpenAPI):
  publications: id, organization_id, publisher_slug, title, slug, platform,
                platform_id, platform_url, cdn_hash, publication_date,
                issue_number, page_count, language, publication_type,
                cover_image_url, storage_cover_path, extraction_status,
                extraction_metadata, source, data_quality_score,
                search_vector, metadata, created_at, updated_at

  nuke_production_credits: id, image_identity_id, publication_id, issue_id,
                           person_name, user_id, organization_id, role,
                           source, confidence, start_date, end_date, created_at
"""

import json
import os
import sqlite3
import time
import urllib.request
import urllib.error
from pathlib import Path

SUPABASE_URL = os.environ.get(
    "SUPABASE_REST_URL",
    "https://PROJECT_REF.supabase.co/rest/v1"
)
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "SET_ME")

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

DB_PATH = Path.home() / "email_intelligence.db"
INDEX_PATH = Path.home() / "publication_map" / "INDEX.json"

# Role mapping: local DB role -> Supabase enum
ROLE_MAP = {
    "photography": "photographer",
    "editorial": "editor",
    "design": "art_director",
    "print": "producer",
    "bouclage": "producer",
    "advertising": "pr_manager",
    "distribution": "producer",
    "casting": "casting_director",
    "styling": "stylist",
    "production": "producer",
    "prepress": "producer",
    "planning": "producer",
    "general": "editor",
}

# Language mapping
LANG_MAP = {
    "lofficiel_stbarth": "fr",
    "lofficiel_art": "fr",
    "lofficiel_riviera": "fr",
    "lofficiel_voyage": "fr",
    "each_other": "en",
    "art_saint_barth": "en",
    "utopia": "fr",
    "smart_map": "fr",
}

# Summary counters
summary = {
    "publications_created": 0,
    "issues_created": 0,
    "credits_created": 0,
    "errors": [],
}


def supabase_request(method, endpoint, data=None, params=None):
    """Make a request to Supabase REST API."""
    url = f"{SUPABASE_URL}/{endpoint}"
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())

    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, headers=HEADERS, method=method)

    try:
        with urllib.request.urlopen(req) as resp:
            resp_body = resp.read().decode("utf-8")
            if resp_body:
                return resp.status, json.loads(resp_body)
            return resp.status, None
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8") if e.fp else ""
        print(f"  HTTP {e.code}: {body_text}")
        return e.code, body_text


def wait_for_table(table_name, max_retries=5, wait_seconds=30):
    """Wait for a table to exist, retrying up to max_retries times."""
    for attempt in range(max_retries):
        status, resp = supabase_request("GET", table_name, params={"limit": "0"})
        if status == 200:
            return True
        print(f"  Table '{table_name}' not ready (HTTP {status}), "
              f"retry {attempt + 1}/{max_retries} in {wait_seconds}s...")
        time.sleep(wait_seconds)
    return False


def get_existing_rows(table_name, select_cols="*", params=None):
    """GET existing rows from a table."""
    p = {"select": select_cols}
    if params:
        p.update(params)
    status, resp = supabase_request("GET", table_name, params=p)
    if status == 200 and isinstance(resp, list):
        return resp
    return []


def post_rows(table_name, rows):
    """POST rows to a table. Returns (status, response) with IDs."""
    headers_with_repr = dict(HEADERS)
    headers_with_repr["Prefer"] = "return=representation"

    body = json.dumps(rows).encode("utf-8")
    url = f"{SUPABASE_URL}/{table_name}"
    req = urllib.request.Request(url, data=body, headers=headers_with_repr, method="POST")

    try:
        with urllib.request.urlopen(req) as resp:
            resp_body = resp.read().decode("utf-8")
            if resp_body:
                return resp.status, json.loads(resp_body)
            return resp.status, None
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8") if e.fp else ""
        print(f"  HTTP {e.code}: {body_text}")
        return e.code, body_text


def submit_publications(index_data):
    """
    Submit publications to Supabase.

    The publications table stores individual issues, not series.
    For publications WITH issues: create one row per issue.
    For publications WITHOUT issues: create one series-level row.

    We use publisher_slug for the series identifier and slug for unique row ID.
    Returns a dict mapping local slug -> list of Supabase UUIDs (one per issue).
    Also returns slug_to_series_id mapping the series slug to first/main pub UUID.
    """
    print("\n=== Step 1: Publications ===")

    if not wait_for_table("publications"):
        summary["errors"].append("publications table not available after retries")
        return {}, {}

    # Check existing publications by our publisher_slugs
    our_slugs = list(index_data.keys())
    slug_to_series_id = {}
    slug_to_issue_ids = {}

    for slug in our_slugs:
        existing = get_existing_rows(
            "publications",
            "id,slug,publisher_slug,issue_number,title",
            params={"publisher_slug": f"eq.{slug}"}
        )
        if existing:
            print(f"  {slug}: {len(existing)} rows already exist")
            slug_to_series_id[slug] = existing[0]["id"]
            slug_to_issue_ids[slug] = {
                r.get("issue_number", ""): r["id"] for r in existing
            }

    rows_to_insert = []

    for slug, pub in index_data.items():
        if slug in slug_to_series_id:
            continue  # already exists

        lang = LANG_MAP.get(slug, "fr")
        issues = pub.get("issues", {})

        if issues:
            # Create one row per issue
            for issue_key, issue_data in issues.items():
                issue_slug = f"{slug}-{issue_key.lower().replace('_', '-')}"
                title = f"{pub['name']} {issue_key.replace('_', ' ')}"

                meta = {
                    "email_count": issue_data.get("email_count", 0),
                    "orgs": issue_data.get("domains", 0),
                    "financial_signals": issue_data.get("financial", 0),
                    "span_days": issue_data.get("span_days", 0),
                    "phases": issue_data.get("phases", {}),
                    "series_type": pub["type"],
                    "territory": ["BL", "FR"] if "stbarth" in slug or "saint_barth" in slug else ["FR"],
                }

                row = {
                    "publisher_slug": slug,
                    "title": title,
                    "slug": issue_slug,
                    "platform": "email_archive",
                    "platform_id": f"{slug}/{issue_key}",
                    "platform_url": f"email://archive/{slug}/{issue_key}",
                    "publication_date": issue_data.get("first_date"),
                    "issue_number": issue_key,
                    "language": lang,
                    "publication_type": "magazine",
                    "extraction_status": "complete",
                    "source": "email_intelligence",
                    "metadata": meta,
                }
                rows_to_insert.append((slug, issue_key, row))
        else:
            # No issues - create a single series-level row
            meta = {
                "total_emails": pub["total_emails"],
                "first_date": pub.get("first_date"),
                "last_date": pub.get("last_date"),
                "span_years": pub.get("span_years"),
                "unique_domains": pub.get("unique_domains"),
                "unique_people": pub.get("unique_people"),
                "financial_emails": pub.get("financial_emails"),
                "series_type": pub["type"],
            }

            row = {
                "publisher_slug": slug,
                "title": pub["name"],
                "slug": slug,
                "platform": "email_archive",
                "platform_id": slug,
                "platform_url": f"email://archive/{slug}",
                "publication_date": pub.get("first_date"),
                "issue_number": None,
                "language": lang,
                "publication_type": "magazine",
                "extraction_status": "complete",
                "source": "email_intelligence",
                "metadata": meta,
            }
            rows_to_insert.append((slug, None, row))

    if rows_to_insert:
        print(f"  Inserting {len(rows_to_insert)} publication rows...")
        # Batch in groups of 50
        for i in range(0, len(rows_to_insert), 50):
            batch_tuples = rows_to_insert[i:i + 50]
            batch_rows = [t[2] for t in batch_tuples]
            status, resp = post_rows("publications", batch_rows)
            if status in (200, 201) and isinstance(resp, list):
                for j, r in enumerate(resp):
                    pub_slug = batch_tuples[j][0]
                    issue_key = batch_tuples[j][1]
                    if pub_slug not in slug_to_series_id:
                        slug_to_series_id[pub_slug] = r["id"]
                    if pub_slug not in slug_to_issue_ids:
                        slug_to_issue_ids[pub_slug] = {}
                    if issue_key:
                        slug_to_issue_ids[pub_slug][issue_key] = r["id"]
                    summary["publications_created"] += 1
                print(f"  Batch {i // 50 + 1}: created {len(resp)} rows")
            else:
                msg = f"Failed to insert publications batch {i // 50 + 1}: HTTP {status}"
                print(f"  {msg}")
                summary["errors"].append(msg)
    else:
        print("  All publications already exist")

    return slug_to_series_id, slug_to_issue_ids


def check_organizations():
    """Check if orgs exist, note IDs. Skip creation."""
    print("\n=== Step 3: Organizations (check only) ===")

    if not wait_for_table("organizations"):
        print("  organizations table not available, skipping")
        return

    existing = get_existing_rows("organizations", "id,name", params={"limit": "10"})
    print(f"  Found {len(existing)} organizations (sample)")
    if existing:
        for org in existing[:5]:
            print(f"    - {org.get('name', 'unnamed')} ({org['id']})")
    print("  Skipping org creation (table has 146 columns, too complex)")


def submit_credits(slug_to_series_id, index_data):
    """Submit top 200 production credits by email_count."""
    print("\n=== Step 4: Production Credits ===")

    if not wait_for_table("nuke_production_credits"):
        summary["errors"].append("nuke_production_credits table not available after retries")
        return

    # Build name->slug mapping from index_data for matching
    name_to_slug = {}
    for slug, pub in index_data.items():
        name_to_slug[pub["name"]] = slug

    # Read top 200 credits from DB (no email addresses sent)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        SELECT person_name, role, publication, email_count, confidence,
               date_start, date_end
        FROM production_credits
        ORDER BY email_count DESC
        LIMIT 200
    """)
    credits = cursor.fetchall()
    conn.close()

    print(f"  Read {len(credits)} credits from DB")

    # Check existing credits
    existing = get_existing_rows(
        "nuke_production_credits",
        "id,person_name,role,publication_id"
    )
    existing_keys = {
        (r.get("person_name"), r.get("role"), r.get("publication_id"))
        for r in existing
    }
    print(f"  Found {len(existing_keys)} existing credits")

    rows_to_insert = []
    skipped = 0
    no_match = set()

    for credit in credits:
        person_name = credit["person_name"]
        local_role = credit["role"]
        publication = credit["publication"]

        # Map role
        mapped_role = ROLE_MAP.get(local_role, local_role)

        # Find publication_id: publication field might be slug or name
        pub_id = None
        if publication in slug_to_series_id:
            pub_id = slug_to_series_id[publication]
        elif publication in name_to_slug:
            pub_id = slug_to_series_id.get(name_to_slug[publication])

        if not pub_id:
            no_match.add(publication)
            skipped += 1
            continue

        if (person_name, mapped_role, pub_id) in existing_keys:
            skipped += 1
            continue

        # Format dates as date-only strings
        date_start = credit["date_start"]
        date_end = credit["date_end"]
        if date_start and "T" in date_start:
            date_start = date_start.split("T")[0]
        if date_end and "T" in date_end:
            date_end = date_end.split("T")[0]

        row = {
            "person_name": person_name,
            "role": mapped_role,
            "publication_id": pub_id,
            "source": "email",
            "confidence": credit["confidence"] or 0.85,
            "start_date": date_start,
            "end_date": date_end,
        }
        rows_to_insert.append(row)

    if skipped:
        print(f"  Skipped {skipped} credits (no pub match or already exist)")
    if no_match:
        print(f"  Unmatched publications: {no_match}")

    if rows_to_insert:
        print(f"  Inserting {len(rows_to_insert)} credits...")
        # Batch in groups of 50
        for i in range(0, len(rows_to_insert), 50):
            batch = rows_to_insert[i:i + 50]
            status, resp = post_rows("nuke_production_credits", batch)
            if status in (200, 201) and isinstance(resp, list):
                summary["credits_created"] += len(resp)
            else:
                msg = f"Failed to insert credits batch {i // 50 + 1}: HTTP {status}"
                print(f"  {msg}")
                summary["errors"].append(msg)
        print(f"  Created {summary['credits_created']} credits")
    else:
        print("  No new credits to insert")


def main():
    print("=" * 60)
    print("Nuke Supabase Data Submission")
    print("=" * 60)

    # Load INDEX.json
    with open(INDEX_PATH) as f:
        index_data = json.load(f)
    print(f"Loaded {len(index_data)} publications from INDEX.json")

    # Step 1: Publications (includes issues as individual rows)
    slug_to_series_id, slug_to_issue_ids = submit_publications(index_data)
    total_issue_rows = sum(len(v) for v in slug_to_issue_ids.values())
    print(f"  Publication ID map: {len(slug_to_series_id)} series, "
          f"{total_issue_rows} issue rows")

    # Step 2: Issues are already created as publication rows above
    print("\n=== Step 2: Publication Issues ===")
    issues_created = sum(
        len(pub.get("issues", {}))
        for pub in index_data.values()
    )
    print(f"  Issues were inserted as publication rows in Step 1")
    summary["issues_created"] = summary["publications_created"]  # counted together

    # Step 3: Organizations (check only)
    check_organizations()

    # Step 4: Production Credits
    submit_credits(slug_to_series_id, index_data)

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Publication rows created: {summary['publications_created']}")
    print(f"  Credits created:          {summary['credits_created']}")
    if summary["errors"]:
        print(f"  Errors ({len(summary['errors'])}):")
        for err in summary["errors"]:
            print(f"    - {err}")
    else:
        print("  Errors: none")
    print("=" * 60)


if __name__ == "__main__":
    main()
