#!/usr/bin/env python3
"""
Fill remaining text fields using Y/M/M spec lookup.
Uses 50-combo batches with robust error handling.
"""
import sys, time
try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'psycopg2-binary', '-q'])
    import psycopg2
    from psycopg2.extras import execute_values

DB = "postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
COMBO_BATCH = 50


def get_conn():
    c = psycopg2.connect(DB, connect_timeout=10,
                         keepalives=1, keepalives_idle=30,
                         keepalives_interval=10, keepalives_count=3,
                         options='-c statement_timeout=60000 -c lock_timeout=5000')
    c.autocommit = True
    cur = c.cursor()
    cur.execute("SET session_replication_role = replica")
    return c, cur


conn, cur = get_conn()

FIELDS = [
    "drivetrain", "engine_type", "engine_size",
    "transmission_type", "steering_type", "frame_type",
    "suspension_front", "suspension_rear", "brake_type_front", "brake_type_rear",
]

# Verify lookup exists
cur.execute("SELECT count(*) FROM _ymm_spec_lookup")
print(f"Lookup: {cur.fetchone()[0]:,} combos", flush=True)

grand_total = 0

for field in FIELDS:
    null_check = f"(v.{field} IS NULL OR v.{field} = '')"
    t0 = time.time()

    # Fetch combos — this is a small result set from the lookup table
    try:
        cur.execute(f"SELECT year, make, model, {field} FROM _ymm_spec_lookup WHERE {field} IS NOT NULL")
        combos = cur.fetchall()
    except Exception as e:
        print(f"  {field}: fetch error — {e}", flush=True)
        try: conn.close()
        except: pass
        time.sleep(2)
        conn, cur = get_conn()
        # Retry fetch
        cur.execute(f"SELECT year, make, model, {field} FROM _ymm_spec_lookup WHERE {field} IS NOT NULL")
        combos = cur.fetchall()

    if not combos:
        print(f"  {field}: 0 combos", flush=True)
        continue

    field_total = 0
    skipped = 0
    errors = 0

    total_batches = (len(combos) + COMBO_BATCH - 1) // COMBO_BATCH
    RECONN_EVERY = 800  # Proactive reconnect before PgBouncer kills us
    for i in range(0, len(combos), COMBO_BATCH):
        batch_num = i // COMBO_BATCH + 1
        batch = combos[i:i + COMBO_BATCH]
        # Proactive reconnect to avoid PgBouncer lifetime drops
        if batch_num % RECONN_EVERY == 0:
            elapsed_so_far = time.time() - t0
            print(f"    {field}: batch {batch_num}/{total_batches}, {field_total:,} filled ({elapsed_so_far:.0f}s) — reconnecting", flush=True)
            try: conn.close()
            except: pass
            conn, cur = get_conn()
        elif batch_num % 200 == 0:
            elapsed_so_far = time.time() - t0
            print(f"    {field}: batch {batch_num}/{total_batches}, {field_total:,} filled ({elapsed_so_far:.0f}s)", flush=True)
        for attempt in range(3):
            try:
                execute_values(
                    cur,
                    f"""UPDATE vehicles v
                        SET {field} = data.val::text, updated_at = now()
                        FROM (VALUES %s) AS data(yr, mk, mdl, val)
                        WHERE v.year = data.yr::int AND v.make = data.mk AND v.model = data.mdl
                          AND {null_check}""",
                    [(r[0], r[1], r[2], r[3]) for r in batch],
                    template="(%s, %s, %s, %s)"
                )
                field_total += cur.rowcount
                break
            except (psycopg2.errors.LockNotAvailable, psycopg2.errors.DeadlockDetected,
                    psycopg2.errors.QueryCanceled):
                skipped += len(batch)
                break
            except Exception as e:
                if attempt < 2:
                    try: conn.close()
                    except: pass
                    time.sleep(1)
                    conn, cur = get_conn()
                else:
                    errors += len(batch)
                    break

    elapsed = time.time() - t0
    grand_total += field_total
    rate = field_total / elapsed if elapsed > 0 else 0
    extra = ""
    if skipped: extra += f", {skipped} skipped"
    if errors: extra += f", {errors} errors"
    print(f"  {field}: {field_total:,} filled from {len(combos):,} combos ({elapsed:.1f}s, {rate:.0f}/s{extra})", flush=True)

print(f"\nGrand total: {grand_total:,} text field-fills", flush=True)

# OEM overlay for text fields
print("\nOEM overlay...", flush=True)
for veh_col, oem_col in [("engine_size", "engine_size"), ("fuel_type", "fuel_type"),
                          ("drivetrain", "drivetrain"), ("body_style", "body_style")]:
    try:
        cur.execute(f"""
            UPDATE vehicles v SET {veh_col} = o.{oem_col}, updated_at = now()
            FROM oem_vehicle_specs o
            WHERE v.make = o.make AND v.model = o.model
              AND v.year BETWEEN o.year_start AND o.year_end
              AND (v.{veh_col} IS NULL OR v.{veh_col} = '')
              AND o.{oem_col} IS NOT NULL
        """)
        if cur.rowcount > 0:
            print(f"  {veh_col}: {cur.rowcount:,} from OEM", flush=True)
    except Exception as e:
        print(f"  {veh_col} OEM: {e}", flush=True)

# Final coverage
print("\n" + "=" * 60, flush=True)
print("FINAL COVERAGE", flush=True)
print("=" * 60, flush=True)

cur.execute("""
    SELECT
      COUNT(*) as total,
      COUNT(horsepower) as horsepower,
      COUNT(torque) as torque,
      COUNT(weight_lbs) as weight,
      COUNT(doors) as doors,
      COUNT(seats) as seats,
      COUNT(wheelbase_inches) as wheelbase,
      COUNT(length_inches) as length,
      COUNT(width_inches) as width,
      COUNT(height_inches) as height,
      COUNT(mpg_city) as mpg_city,
      COUNT(mpg_highway) as mpg_highway,
      COUNT(zero_to_sixty) as zero_to_sixty,
      COUNT(top_speed_mph) as top_speed,
      COUNT(engine_liters) as engine_liters,
      COUNT(NULLIF(fuel_type,'')) as fuel_type,
      COUNT(NULLIF(body_style,'')) as body_style,
      COUNT(NULLIF(drivetrain,'')) as drivetrain,
      COUNT(NULLIF(engine_type,'')) as engine_type,
      COUNT(NULLIF(engine_size,'')) as engine_size,
      COUNT(NULLIF(transmission_type,'')) as trans_type
    FROM vehicles
""")
row = cur.fetchone()
cols = [d[0] for d in cur.description]
total = row[0]
for col, val in zip(cols, row):
    if col == 'total':
        print(f"  {col}: {val:,}", flush=True)
    else:
        pct = val / total * 100
        print(f"  {col}: {val:,} ({pct:.1f}%)", flush=True)

cur.execute("RESET session_replication_role")
conn.close()
print("\nDone!", flush=True)
