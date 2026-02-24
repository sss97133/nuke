#!/usr/bin/env python3
"""Bulk fix garbage make fields — triggers disabled via session_replication_role."""
import sys
try:
    import psycopg2
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'psycopg2-binary', '-q'])
    import psycopg2

DB = "postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
BATCH = 3000

conn = psycopg2.connect(DB)
conn.autocommit = True
cur = conn.cursor()
cur.execute("SET statement_timeout = '300s'")
cur.execute("SET session_replication_role = replica")

total = 0
batch_num = 0

# Phase 1: garbage prefix makes — re-parse from model field
PHASE1_SQL = """
WITH garbage AS (
  SELECT id, model FROM vehicles
  WHERE (make ~ '^\\d+k-Mile$' OR make ~* '-Powered$'
    OR make IN ('Modified','Original-Owner','Supercharged','Euro',
                'One-Family-Owned','No-Reserve','Illuminated'))
    AND model ~ '^\\d{4}\\s+'
  LIMIT %s
),
parsed AS (
  SELECT id,
    CASE
      WHEN regexp_replace(model, '^\\d{4}\\s+', '') ~* '^land rover\\s' THEN 'Land Rover'
      WHEN regexp_replace(model, '^\\d{4}\\s+', '') ~* '^alfa romeo\\s' THEN 'Alfa Romeo'
      WHEN regexp_replace(model, '^\\d{4}\\s+', '') ~* '^aston martin\\s' THEN 'Aston Martin'
      WHEN regexp_replace(model, '^\\d{4}\\s+', '') ~* '^de tomaso\\s' THEN 'De Tomaso'
      WHEN regexp_replace(model, '^\\d{4}\\s+', '') ~* '^austin healey\\s' THEN 'Austin Healey'
      WHEN regexp_replace(model, '^\\d{4}\\s+', '') ~* '^rolls royce\\s' THEN 'Rolls Royce'
      ELSE split_part(regexp_replace(model, '^\\d{4}\\s+', ''), ' ', 1)
    END as new_make,
    CASE
      WHEN regexp_replace(model, '^\\d{4}\\s+', '') ~* '^land rover\\s' THEN regexp_replace(regexp_replace(model, '^\\d{4}\\s+', ''), '^[Ll]and [Rr]over\\s+', '')
      WHEN regexp_replace(model, '^\\d{4}\\s+', '') ~* '^alfa romeo\\s' THEN regexp_replace(regexp_replace(model, '^\\d{4}\\s+', ''), '^[Aa]lfa [Rr]omeo\\s+', '')
      WHEN regexp_replace(model, '^\\d{4}\\s+', '') ~* '^aston martin\\s' THEN regexp_replace(regexp_replace(model, '^\\d{4}\\s+', ''), '^[Aa]ston [Mm]artin\\s+', '')
      WHEN regexp_replace(model, '^\\d{4}\\s+', '') ~* '^de tomaso\\s' THEN regexp_replace(regexp_replace(model, '^\\d{4}\\s+', ''), '^[Dd]e [Tt]omaso\\s+', '')
      WHEN regexp_replace(model, '^\\d{4}\\s+', '') ~* '^austin healey\\s' THEN regexp_replace(regexp_replace(model, '^\\d{4}\\s+', ''), '^[Aa]ustin [Hh]ealey\\s+', '')
      WHEN regexp_replace(model, '^\\d{4}\\s+', '') ~* '^rolls royce\\s' THEN regexp_replace(regexp_replace(model, '^\\d{4}\\s+', ''), '^[Rr]olls [Rr]oyce\\s+', '')
      ELSE regexp_replace(regexp_replace(model, '^\\d{4}\\s+', ''), '^\\S+\\s*', '')
    END as new_model
  FROM garbage
)
UPDATE vehicles v
SET make = p.new_make, model = p.new_model, updated_at = now()
FROM parsed p
WHERE v.id = p.id AND p.new_make <> ''
"""

while True:
    batch_num += 1
    cur.execute(PHASE1_SQL, (BATCH,))
    count = cur.rowcount
    total += count
    print(f"  Phase 1 batch {batch_num}: {count} rows (total: {total})", flush=True)
    if count == 0:
        break

print(f"Phase 1 complete: {total} rows fixed", flush=True)

# Phase 2: Direct renames
RENAMES = [
    ("Land", "Land Rover", "Rover "),
    ("Alfa", "Alfa Romeo", "Romeo "),
    ("De", "De Tomaso", "Tomaso "),
]

for old_make, new_make, model_prefix in RENAMES:
    p2_total = 0
    while True:
        cur.execute("""
            WITH batch AS (SELECT id FROM vehicles WHERE make = %s LIMIT 3000)
            UPDATE vehicles v SET make = %s, model = %s || COALESCE(v.model, ''), updated_at = now()
            FROM batch b WHERE v.id = b.id
        """, (old_make, new_make, model_prefix))
        count = cur.rowcount
        p2_total += count
        if count == 0:
            break
    print(f"  {old_make} -> {new_make}: {p2_total} renamed", flush=True)

# porsche -> Porsche
cur.execute("UPDATE vehicles SET make = 'Porsche', updated_at = now() WHERE make = 'porsche'")
print(f"  porsche -> Porsche: {cur.rowcount} renamed", flush=True)

cur.execute("RESET session_replication_role")
print("All done!", flush=True)
conn.close()
