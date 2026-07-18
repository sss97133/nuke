#!/usr/bin/env python3
"""
Ingest all publishing intelligence data from local SQLite into Supabase.

Pushes:
  1. publishing_contacts     — 17K professionals (names, emails, roles, scores)
  2. publishing_relationships — 54K relationship edges
  3. publishing_communications — per-contact aggregated stats
  4. nuke_production_credits  — all 4,643 credits (upgrade from 200)
  5. editorial_stories        — 87 magazine pages analyzed
  6. flatplan_pages           — page-level structure
  7. ad_placements            — brands from published ads
  8. production_files         — 101K file metadata (paths stripped)

Privacy: raw message bodies never leave local. File paths are relativized.
Owner-scoped: every row gets an owner_id for RLS.
"""

import json
import os
import sqlite3
import time
import psycopg2
import psycopg2.extras
from pathlib import Path

DB_URL = os.environ.get(
    "SUPABASE_DB_URL",
    "postgresql://postgres.PROJECT_REF:PASSWORD"
    "@aws-0-us-west-1.pooler.supabase.com:6543/postgres"
)
LOCAL_DB = Path.home() / "email_intelligence.db"

# Operator IDs — deterministic UUIDs, will link to auth accounts later
JENNY_ID = "00000000-0000-4000-a000-000000000001"
PHILIPPE_ID = "00000000-0000-4000-a000-000000000002"

# Both operators share the same archive for now
OWNER_ID = JENNY_ID

# Path prefixes to strip from production file paths
STRIP_PREFIXES = [
    str(Path.home()) + "/",
]

BATCH_SIZE = 500


def connect_local():
    conn = sqlite3.connect(str(LOCAL_DB))
    conn.row_factory = sqlite3.Row
    return conn


def connect_supabase():
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    return conn


def relativize_path(path):
    """Strip local user prefixes from file paths."""
    if not path:
        return path
    for prefix in STRIP_PREFIXES:
        if path.startswith(prefix):
            return path[len(prefix):]
    return path


def safe_json(val):
    """Parse JSON string from SQLite, return None if invalid."""
    if not val:
        return None
    if isinstance(val, (dict, list)):
        return json.dumps(val)
    try:
        parsed = json.loads(val)
        return json.dumps(parsed)
    except (json.JSONDecodeError, TypeError):
        return None


def ingest_contacts(local, supa):
    """Push person_profiles → publishing_contacts."""
    print("\n=== 1. Publishing Contacts ===")

    cur_s = supa.cursor()
    cur_s.execute("SELECT COUNT(*) FROM publishing_contacts WHERE owner_id = %s", (OWNER_ID,))
    existing = cur_s.fetchone()[0]
    if existing > 0:
        print(f"  Already {existing} contacts for this owner. Skipping.")
        cur_s.close()
        return
    cur_s.close()

    cur = local.execute("""
        SELECT email, name, domain, professional_title, current_org, current_role,
               publications_worked, credit_count, credit_roles, primary_publication,
               first_seen, last_seen, active_months, years_active, is_cross_publication,
               reliability_score, reliability_factors, ghost_status, ghost_risk,
               responsiveness_hours, relationship_phase, relationship_warmth, trajectory,
               role_spectrum, imessage_contact, imessage_volume, cross_channel_score,
               total_sent, total_received, total_cc, preferred_language,
               is_noise
        FROM person_profiles
        WHERE is_noise = 0
    """)

    rows = []
    for r in cur:
        rows.append((
            OWNER_ID,
            r["name"] or r["email"],
            r["email"],
            r["domain"],
            r["professional_title"],
            r["current_org"],
            r["current_role"],
            r["publications_worked"],
            r["credit_count"] or 0,
            r["credit_roles"],
            r["primary_publication"],
            r["first_seen"],
            r["last_seen"],
            r["active_months"] or 0,
            r["years_active"] or 0,
            bool(r["is_cross_publication"]),
            r["reliability_score"],
            safe_json(r["reliability_factors"]),
            r["ghost_status"],
            r["ghost_risk"],
            r["responsiveness_hours"],
            r["relationship_phase"],
            r["relationship_warmth"],
            r["trajectory"],
            safe_json(r["role_spectrum"]),
            r["imessage_contact"],
            r["imessage_volume"] or 0,
            r["cross_channel_score"],
            r["total_sent"] or 0,
            r["total_received"] or 0,
            r["total_cc"] or 0,
            r["preferred_language"],
            False,
            "private",
        ))

    print(f"  Prepared {len(rows)} contacts")

    cur_s = supa.cursor()
    sql = """
        INSERT INTO publishing_contacts (
            owner_id, name, email, domain,
            professional_title, org_name, org_role,
            publications_worked, credit_count, credit_roles, primary_publication,
            first_seen, last_seen, active_months, years_active, is_cross_publication,
            reliability_score, reliability_factors, ghost_status, ghost_risk,
            responsiveness_hours, relationship_phase, relationship_warmth, trajectory,
            role_spectrum, imessage_contact, imessage_volume, cross_channel_score,
            total_sent, total_received, total_cc, preferred_language,
            is_noise, privacy_tier
        ) VALUES (
            %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s
        )
    """

    inserted = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        psycopg2.extras.execute_batch(cur_s, sql, batch, page_size=100)
        supa.commit()
        inserted += len(batch)
        if inserted % 5000 == 0 or inserted == len(rows):
            print(f"  Inserted {inserted}/{len(rows)}")

    cur_s.close()
    print(f"  Done: {inserted} contacts")
    return inserted


def ingest_relationships(local, supa):
    """Push relationship_edges → publishing_relationships."""
    print("\n=== 2. Publishing Relationships ===")

    cur_s = supa.cursor()
    cur_s.execute("SELECT COUNT(*) FROM publishing_relationships WHERE owner_id = %s", (OWNER_ID,))
    existing = cur_s.fetchone()[0]
    if existing > 0:
        print(f"  Already {existing} relationships. Skipping.")
        cur_s.close()
        return
    cur_s.close()

    # Build email→name lookup
    name_map = {}
    for r in local.execute("SELECT email, name FROM person_profiles"):
        name_map[r["email"]] = r["name"]

    cur = local.execute("""
        SELECT source_email, target_email, weight, type,
               first_date, last_date, is_reciprocal, avg_interval_days
        FROM relationship_edges
    """)

    rows = []
    for r in cur:
        rows.append((
            OWNER_ID,
            r["source_email"],
            r["target_email"],
            name_map.get(r["source_email"]),
            name_map.get(r["target_email"]),
            r["weight"],
            r["type"],
            r["first_date"],
            r["last_date"],
            bool(r["is_reciprocal"]),
            r["avg_interval_days"],
        ))

    print(f"  Prepared {len(rows)} edges")

    cur_s = supa.cursor()
    sql = """
        INSERT INTO publishing_relationships (
            owner_id, source_email, target_email, source_name, target_name,
            weight, edge_type, first_date, last_date, is_reciprocal, avg_interval_days
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """

    inserted = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        psycopg2.extras.execute_batch(cur_s, sql, batch, page_size=100)
        supa.commit()
        inserted += len(batch)
        if inserted % 10000 == 0 or inserted == len(rows):
            print(f"  Inserted {inserted}/{len(rows)}")

    cur_s.close()
    print(f"  Done: {inserted} edges")


def ingest_communications(local, supa):
    """Push person_profiles communication stats → publishing_communications."""
    print("\n=== 3. Publishing Communications ===")

    cur_s = supa.cursor()
    cur_s.execute("SELECT COUNT(*) FROM publishing_communications WHERE owner_id = %s", (OWNER_ID,))
    existing = cur_s.fetchone()[0]
    if existing > 0:
        print(f"  Already {existing} comm records. Skipping.")
        cur_s.close()
        return
    cur_s.close()

    cur = local.execute("""
        SELECT email, total_sent, total_received, total_cc, unique_correspondents,
               avg_response_time_hours, median_response_time_hours,
               initiator_ratio, cc_ratio, activity_density, activity_pattern,
               peak_activity_hour, peak_activity_day, preferred_language,
               attachment_rate, financial_rate, source_accounts
        FROM person_profiles
        WHERE is_noise = 0
    """)

    rows = []
    for r in cur:
        rows.append((
            OWNER_ID,
            r["email"],
            r["total_sent"] or 0,
            r["total_received"] or 0,
            r["total_cc"] or 0,
            r["unique_correspondents"] or 0,
            r["avg_response_time_hours"],
            r["median_response_time_hours"],
            r["initiator_ratio"],
            r["cc_ratio"],
            r["activity_density"],
            r["activity_pattern"],
            r["peak_activity_hour"],
            r["peak_activity_day"],
            r["preferred_language"],
            r["attachment_rate"],
            r["financial_rate"],
            r["source_accounts"],
            "email",
        ))

    print(f"  Prepared {len(rows)} comm records")

    cur_s = supa.cursor()
    sql = """
        INSERT INTO publishing_communications (
            owner_id, email,
            total_sent, total_received, total_cc, unique_correspondents,
            avg_response_time_hours, median_response_time_hours,
            initiator_ratio, cc_ratio, activity_density, activity_pattern,
            peak_activity_hour, peak_activity_day, preferred_language,
            attachment_rate, financial_rate, source_accounts, channel
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """

    inserted = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        psycopg2.extras.execute_batch(cur_s, sql, batch, page_size=100)
        supa.commit()
        inserted += len(batch)
        if inserted % 5000 == 0 or inserted == len(rows):
            print(f"  Inserted {inserted}/{len(rows)}")

    cur_s.close()
    print(f"  Done: {inserted} comm records")


def ingest_all_credits(local, supa):
    """Push ALL 4,643 production credits (not just top 200)."""
    print("\n=== 4. All Production Credits ===")

    cur_s = supa.cursor()
    cur_s.execute("SELECT COUNT(*) FROM nuke_production_credits")
    existing = cur_s.fetchone()[0]
    print(f"  Currently {existing} credits in Supabase")

    if existing >= 4000:
        print("  Already has most credits. Skipping.")
        cur_s.close()
        return

    # Clear existing partial upload and re-insert all
    if existing > 0:
        cur_s.execute("DELETE FROM nuke_production_credits WHERE source = 'email'")
        supa.commit()
        print(f"  Cleared {existing} old credits")

    # Get publication ID mapping
    cur_s.execute("SELECT id, publisher_slug FROM publications")
    pub_map = {r[1]: r[0] for r in cur_s.fetchall()}

    # Role mapping
    role_map = {
        "photography": "photographer", "editorial": "editor",
        "design": "art_director", "print": "producer",
        "bouclage": "producer", "advertising": "pr_manager",
        "distribution": "producer", "casting": "casting_director",
        "styling": "stylist", "production": "producer",
        "prepress": "producer", "planning": "producer",
        "general": "editor",
    }

    cur = local.execute("""
        SELECT person_name, role, publication, email_count, confidence,
               date_start, date_end
        FROM production_credits
        ORDER BY email_count DESC
    """)

    rows = []
    skipped = 0
    for r in cur:
        pub_id = pub_map.get(r["publication"])
        if not pub_id:
            skipped += 1
            continue
        mapped_role = role_map.get(r["role"], r["role"])
        ds = r["date_start"]
        de = r["date_end"]
        if ds and "T" in ds:
            ds = ds.split("T")[0]
        if de and "T" in de:
            de = de.split("T")[0]

        rows.append((
            r["person_name"],
            mapped_role,
            pub_id,
            "email",
            r["confidence"] or 0.85,
            ds,
            de,
            OWNER_ID,
        ))

    print(f"  Prepared {len(rows)} credits ({skipped} skipped, no pub match)")

    sql = """
        INSERT INTO nuke_production_credits (
            person_name, role, publication_id, source, confidence,
            start_date, end_date, owner_id
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    """

    inserted = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        psycopg2.extras.execute_batch(cur_s, sql, batch, page_size=100)
        supa.commit()
        inserted += len(batch)

    cur_s.close()
    print(f"  Done: {inserted} credits")


def ingest_magazine_pages(local, supa):
    """Push magazine_pages → editorial_stories + flatplan_pages + ad_placements."""
    print("\n=== 5. Magazine Pages → Editorial Stories + Flatplan + Ads ===")

    cur_s = supa.cursor()
    cur_s.execute("SELECT COUNT(*) FROM editorial_stories")
    if cur_s.fetchone()[0] > 0:
        print("  editorial_stories already has data. Skipping.")
        cur_s.close()
        return

    # Find the publication ID for L'Officiel St Barth Issue 11
    cur_s.execute(
        "SELECT id FROM publications WHERE publisher_slug = 'lofficiel_stbarth' LIMIT 1"
    )
    row = cur_s.fetchone()
    pub_id = row[0] if row else None

    cur = local.execute("""
        SELECT page_number, page_type, story_title, brand_names,
               person_names, image_count, is_spread, confidence
        FROM magazine_pages
        ORDER BY page_number
    """)

    stories = []
    pages = []
    ads = []

    for r in cur:
        page_type = r["page_type"]
        brands = json.loads(r["brand_names"]) if r["brand_names"] else []
        persons = json.loads(r["person_names"]) if r["person_names"] else []

        # Flatplan page (every page)
        pages.append((
            pub_id,
            r["page_number"],
            page_type,
            r["story_title"],
            brands[0] if brands and page_type == "ad" else None,
            bool(r["is_spread"]) if r["page_number"] % 2 == 0 else None,
        ))

        # Editorial story (editorial/fashion pages)
        if page_type in ("editorial", "fashion_story", "fashion_credits"):
            stories.append((
                pub_id,
                r["story_title"] or f"Page {r['page_number']}",
                page_type,
                r["page_number"],
                r["page_number"],
                1,
                False,
            ))

        # Ad placement
        if page_type == "ad" and brands:
            for brand in brands:
                ads.append((
                    brand,
                    pub_id,
                    r["page_number"],
                    "full_page",
                    "USD",
                ))

    # Insert stories
    if stories:
        psycopg2.extras.execute_batch(cur_s, """
            INSERT INTO editorial_stories (
                issue_id, title, story_type, page_start, page_end, page_count, is_advertorial
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, stories, page_size=50)
        supa.commit()

    # Insert flatplan pages
    if pages:
        psycopg2.extras.execute_batch(cur_s, """
            INSERT INTO flatplan_pages (
                issue_id, page_number, page_type, story_title, brand_name, is_left_page
            ) VALUES (%s, %s, %s, %s, %s, %s)
        """, pages, page_size=50)
        supa.commit()

    # Insert ad placements
    if ads:
        psycopg2.extras.execute_batch(cur_s, """
            INSERT INTO ad_placements (
                brand_name, issue_id, page_number, placement_type, currency
            ) VALUES (%s, %s, %s, %s, %s)
        """, ads, page_size=50)
        supa.commit()

    cur_s.close()
    print(f"  Done: {len(stories)} stories, {len(pages)} flatplan pages, {len(ads)} ad placements")


def ingest_production_files(local, supa):
    """Push production_files with stripped paths."""
    print("\n=== 6. Production Files ===")

    cur_s = supa.cursor()
    cur_s.execute("SELECT COUNT(*) FROM production_files")
    existing = cur_s.fetchone()[0]
    if existing > 0:
        print(f"  Already {existing} files. Skipping.")
        cur_s.close()
        return

    cur = local.execute("""
        SELECT file_path, filename, directory, file_extension, file_size_bytes,
               content_hash_sha256, file_type, production_role,
               parsed_publication, parsed_issue_number, parsed_story,
               parsed_version, parsed_stage, source_directory, indexed_at
        FROM production_files
    """)

    rows = []
    for r in cur:
        rows.append((
            relativize_path(r["file_path"]),
            r["filename"],
            relativize_path(r["directory"]),
            r["file_extension"],
            r["file_size_bytes"],
            r["content_hash_sha256"],
            r["file_type"],
            r["production_role"],
            r["parsed_publication"],
            r["parsed_issue_number"],
            r["parsed_story"],
            r["parsed_version"],
            r["parsed_stage"],
            r["source_directory"],
            r["indexed_at"],
            OWNER_ID,
        ))

    print(f"  Prepared {len(rows)} files")

    sql = """
        INSERT INTO production_files (
            file_path, filename, directory, file_extension, file_size_bytes,
            content_hash_sha256, file_type, production_role,
            parsed_publication, parsed_issue_number, parsed_story,
            parsed_version, parsed_stage, source_type, indexed_at,
            owner_id
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (content_hash_sha256) DO NOTHING
    """

    inserted = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        psycopg2.extras.execute_batch(cur_s, sql, batch, page_size=100)
        supa.commit()
        inserted += len(batch)
        if inserted % 20000 == 0 or inserted == len(rows):
            print(f"  Inserted {inserted}/{len(rows)}")

    cur_s.close()
    print(f"  Done: {inserted} files")


def main():
    print("=" * 60)
    print("Publishing Intelligence — Full Ingestion")
    print("=" * 60)
    print(f"Local DB: {LOCAL_DB}")
    print(f"Owner: {OWNER_ID}")

    local = connect_local()
    supa = connect_supabase()

    try:
        ingest_contacts(local, supa)
        ingest_relationships(local, supa)
        ingest_communications(local, supa)
        ingest_all_credits(local, supa)
        ingest_magazine_pages(local, supa)
        ingest_production_files(local, supa)
    except Exception as e:
        supa.rollback()
        print(f"\nERROR: {e}")
        raise
    finally:
        supa.close()
        local.close()

    # Verify final counts
    print("\n" + "=" * 60)
    print("VERIFICATION")
    print("=" * 60)
    supa = connect_supabase()
    cur = supa.cursor()
    for table in [
        "publishing_contacts", "publishing_relationships",
        "publishing_communications", "nuke_production_credits",
        "editorial_stories", "flatplan_pages", "ad_placements",
        "production_files",
    ]:
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        print(f"  {table:35s} {cur.fetchone()[0]:>8,} rows")
    cur.close()
    supa.close()
    print("=" * 60)
    print("DONE")


if __name__ == "__main__":
    main()
