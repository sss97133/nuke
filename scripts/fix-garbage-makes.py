#!/usr/bin/env python3
"""
Fix garbage make fields from BaT title parsing.

Patterns fixed:
  1. Mileage prefix: "33k-Mile" → re-parse make/model from model field
  2. -Powered suffix: "350-Powered" → re-parse make/model from model field
  3. BaT prefixes: "Modified", "Original-Owner", etc. → re-parse
  4. Split names: "Land" → "Land Rover", "Alfa" → "Alfa Romeo"
  5. Case: "porsche" → "Porsche"

Safe to run multiple times (idempotent).
"""
import sys
import re
import time

try:
    import psycopg2
    from psycopg2.extras import execute_batch
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'psycopg2-binary', '-q'])
    import psycopg2
    from psycopg2.extras import execute_batch

# Use port 5432 (session pooler) - port 6543 (transaction pooler) is often saturated
DB_URL = "postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:5432/postgres"

# Two-word makes that get split
TWO_WORD_MAKES = {
    'land rover', 'alfa romeo', 'aston martin', 'de tomaso', 'austin healey',
    'rolls royce',
}

# Direct make renames (case fixes + split names)
MAKE_RENAMES = {
    'porsche': 'Porsche',
    'Land': 'Land Rover',
    'Alfa': 'Alfa Romeo',
}

# Garbage make patterns that need re-parsing from model field
GARBAGE_PATTERNS = [
    re.compile(r'^\d+k-Mile$', re.I),
    re.compile(r'-Powered$', re.I),
]
GARBAGE_EXACT = {
    'Modified', 'Original-Owner', 'Supercharged', 'Euro',
    'One-Family-Owned', 'No-Reserve', 'Illuminated',
}


def parse_make_from_model(model_str):
    """Extract make and model from a 'YEAR MAKE MODEL...' string."""
    # Strip year prefix
    trimmed = re.sub(r'^\d{4}\s+', '', model_str).strip()
    if not trimmed:
        return None, None

    # Check for two-word makes
    for twm in TWO_WORD_MAKES:
        if trimmed.lower().startswith(twm + ' '):
            new_make = trimmed[:len(twm)]
            new_model = trimmed[len(twm):].strip()
            # Title-case the make
            new_make = ' '.join(w.capitalize() for w in new_make.split())
            return new_make, new_model

    # Single-word make
    parts = trimmed.split(None, 1)
    if len(parts) >= 2:
        return parts[0], parts[1]
    elif len(parts) == 1:
        return parts[0], ''
    return None, None


def is_garbage_make(make):
    if make in GARBAGE_EXACT:
        return True
    for pat in GARBAGE_PATTERNS:
        if pat.match(make):
            return True
    return False


def main():
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    cur = conn.cursor()

    # Phase 1: Fix garbage makes by re-parsing model field
    print(f"[{time.strftime('%H:%M:%S')}] Phase 1: Fix garbage-prefix makes...")
    cur.execute(r"""
        SELECT id, make, model FROM vehicles
        WHERE (make ~ '^\d+k-Mile$' OR make ~ '-Powered$'
          OR make IN ('Modified','Original-Owner','Supercharged','Euro',
                      'One-Family-Owned','No-Reserve','Illuminated'))
          AND model ~ '^\d{4}\s+'
    """)
    rows = cur.fetchall()
    print(f"  Found {len(rows)} vehicles to fix")

    updates = []
    for vid, old_make, old_model in rows:
        new_make, new_model = parse_make_from_model(old_model)
        if new_make and new_model:
            updates.append((new_make, new_model, str(vid)))

    print(f"  Parsed {len(updates)} fixable updates")

    # Close read connection, open fresh write connection with autocommit
    cur.close()
    conn.close()
    print(f"  Connecting for writes on port 5432...", flush=True)
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor()
    # Short lock timeout: skip locked rows instead of waiting
    cur.execute("SET lock_timeout = '2s'")
    cur.execute("SET statement_timeout = '10s'")
    print(f"  Connected. Starting writes...", flush=True)

    written = 0
    skipped = 0
    errors = 0
    for new_make, new_model, vid in updates:
        try:
            cur.execute(
                "UPDATE vehicles SET make = %s, model = %s, updated_at = now() WHERE id = %s",
                (new_make, new_model, vid)
            )
            written += 1
        except psycopg2.errors.LockNotAvailable:
            skipped += 1
            conn.rollback()  # reset transaction state in autocommit
        except psycopg2.errors.QueryCanceled:
            skipped += 1
            conn.rollback()
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"  Error ({type(e).__name__}): {e}")
            try:
                conn.close()
            except Exception:
                pass
            time.sleep(1)
            conn = psycopg2.connect(DB_URL)
            conn.autocommit = True
            cur = conn.cursor()
            cur.execute("SET lock_timeout = '2s'")
            cur.execute("SET statement_timeout = '10s'")
        if (written + skipped) % 500 == 0 and (written + skipped) > 0:
            print(f"  ... {written}/{len(updates)} written, {skipped} skipped, {errors} errors", flush=True)
    print(f"  ... {written}/{len(updates)} written, {skipped} skipped, {errors} errors", flush=True)

    print(f"[{time.strftime('%H:%M:%S')}] Phase 1 done: {written} makes fixed, {skipped} skipped (locked)")

    # Phase 2: Direct renames in small batches to avoid timeouts
    print(f"\n[{time.strftime('%H:%M:%S')}] Phase 2: Direct make renames...")
    cur.execute("SET statement_timeout = '30s'")
    cur.execute("SET lock_timeout = '5s'")
    for old_make, new_make in MAKE_RENAMES.items():
        total_renamed = 0
        while True:
            try:
                if old_make == 'Land':
                    cur.execute("""
                        WITH batch AS (SELECT id FROM vehicles WHERE make = %s LIMIT 200)
                        UPDATE vehicles v SET make = %s, model = 'Rover ' || COALESCE(model, ''), updated_at = now()
                        FROM batch b WHERE v.id = b.id
                    """, (old_make, new_make))
                elif old_make == 'Alfa':
                    cur.execute("""
                        WITH batch AS (SELECT id FROM vehicles WHERE make = %s LIMIT 200)
                        UPDATE vehicles v SET make = %s, model = 'Romeo ' || COALESCE(model, ''), updated_at = now()
                        FROM batch b WHERE v.id = b.id
                    """, (old_make, new_make))
                else:
                    cur.execute("""
                        WITH batch AS (SELECT id FROM vehicles WHERE make = %s LIMIT 200)
                        UPDATE vehicles v SET make = %s, updated_at = now()
                        FROM batch b WHERE v.id = b.id
                    """, (old_make, new_make))
                count = cur.rowcount
                if count == 0:
                    break
                total_renamed += count
            except Exception as e:
                print(f"  Error renaming '{old_make}': {e}")
                try:
                    conn.close()
                except Exception:
                    pass
                time.sleep(2)
                conn = psycopg2.connect(DB_URL)
                conn.autocommit = True
                cur = conn.cursor()
                cur.execute("SET statement_timeout = '30s'")
                cur.execute("SET lock_timeout = '5s'")
        print(f"  '{old_make}' → '{new_make}': {total_renamed} vehicles")

    print(f"\n[{time.strftime('%H:%M:%S')}] All done!")
    cur.close()
    conn.close()


if __name__ == '__main__':
    main()
