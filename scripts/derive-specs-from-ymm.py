#!/usr/bin/env python3
"""
Bulk-derive vehicle specs from Year/Make/Model matches.

Strategy v6 — Small combo batches, no reconnection:
1. Reuses persistent _ymm_spec_lookup table
2. Batches of 20 Y/M/M combos → small UPDATEs that complete fast
3. NO reconnection on lock errors — just skip and continue (autocommit handles it)
4. session_replication_role=replica to skip triggers
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
COMBO_BATCH = 20  # Small batches — ~100 vehicles per combo = ~2000 per batch


def get_conn():
    c = psycopg2.connect(DB)
    c.autocommit = True
    cur = c.cursor()
    cur.execute("SET statement_timeout = '60s'")
    cur.execute("SET lock_timeout = '5s'")
    cur.execute("SET session_replication_role = replica")
    cur.execute("SET work_mem = '64MB'")
    return c, cur


conn, cur = get_conn()

NUM_FIELDS = [
    "mpg_city", "mpg_highway", "fuel_capacity_gallons",
    "zero_to_sixty", "top_speed_mph", "engine_liters", "transmission_speeds",
    "horsepower", "torque", "weight_lbs",
    "doors", "seats", "wheelbase_inches", "length_inches", "width_inches", "height_inches",
]
TEXT_FIELDS = [
    "fuel_type", "body_style", "drivetrain", "engine_type", "engine_size",
    "transmission_type", "steering_type", "frame_type",
    "suspension_front", "suspension_rear", "brake_type_front", "brake_type_rear",
]

# =============================================================================
# Step 1: Ensure lookup table exists
# =============================================================================
cur.execute("SELECT EXISTS(SELECT 1 FROM pg_tables WHERE tablename = '_ymm_spec_lookup')")
if cur.fetchone()[0]:
    cur.execute("SELECT count(*) FROM _ymm_spec_lookup")
    print(f"Step 1: Reusing existing lookup ({cur.fetchone()[0]:,} combos)", flush=True)
else:
    print("Step 1: Building Y/M/M spec lookup...", flush=True)
    t0 = time.time()
    cur.execute("""
    CREATE TABLE _ymm_spec_lookup AS
    SELECT year, make, model,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY horsepower) FILTER (WHERE horsepower IS NOT NULL)::int as horsepower,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY torque) FILTER (WHERE torque IS NOT NULL)::int as torque,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY weight_lbs) FILTER (WHERE weight_lbs IS NOT NULL)::int as weight_lbs,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY doors) FILTER (WHERE doors IS NOT NULL)::int as doors,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY seats) FILTER (WHERE seats IS NOT NULL)::int as seats,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY wheelbase_inches) FILTER (WHERE wheelbase_inches IS NOT NULL)::int as wheelbase_inches,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY length_inches) FILTER (WHERE length_inches IS NOT NULL)::int as length_inches,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY width_inches) FILTER (WHERE width_inches IS NOT NULL)::int as width_inches,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY height_inches) FILTER (WHERE height_inches IS NOT NULL)::int as height_inches,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY mpg_city) FILTER (WHERE mpg_city IS NOT NULL)::int as mpg_city,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY mpg_highway) FILTER (WHERE mpg_highway IS NOT NULL)::int as mpg_highway,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY fuel_capacity_gallons) FILTER (WHERE fuel_capacity_gallons IS NOT NULL) as fuel_capacity_gallons,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY zero_to_sixty) FILTER (WHERE zero_to_sixty IS NOT NULL) as zero_to_sixty,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY top_speed_mph) FILTER (WHERE top_speed_mph IS NOT NULL)::int as top_speed_mph,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY engine_liters) FILTER (WHERE engine_liters IS NOT NULL) as engine_liters,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY transmission_speeds) FILTER (WHERE transmission_speeds IS NOT NULL)::int as transmission_speeds,
        mode() WITHIN GROUP (ORDER BY fuel_type) FILTER (WHERE fuel_type IS NOT NULL AND fuel_type <> '') as fuel_type,
        mode() WITHIN GROUP (ORDER BY body_style) FILTER (WHERE body_style IS NOT NULL AND body_style <> '') as body_style,
        mode() WITHIN GROUP (ORDER BY drivetrain) FILTER (WHERE drivetrain IS NOT NULL AND drivetrain <> '') as drivetrain,
        mode() WITHIN GROUP (ORDER BY engine_type) FILTER (WHERE engine_type IS NOT NULL AND engine_type <> '') as engine_type,
        mode() WITHIN GROUP (ORDER BY engine_size) FILTER (WHERE engine_size IS NOT NULL AND engine_size <> '') as engine_size,
        mode() WITHIN GROUP (ORDER BY transmission_type) FILTER (WHERE transmission_type IS NOT NULL AND transmission_type <> '') as transmission_type,
        mode() WITHIN GROUP (ORDER BY steering_type) FILTER (WHERE steering_type IS NOT NULL AND steering_type <> '') as steering_type,
        mode() WITHIN GROUP (ORDER BY frame_type) FILTER (WHERE frame_type IS NOT NULL AND frame_type <> '') as frame_type,
        mode() WITHIN GROUP (ORDER BY suspension_front) FILTER (WHERE suspension_front IS NOT NULL AND suspension_front <> '') as suspension_front,
        mode() WITHIN GROUP (ORDER BY suspension_rear) FILTER (WHERE suspension_rear IS NOT NULL AND suspension_rear <> '') as suspension_rear,
        mode() WITHIN GROUP (ORDER BY brake_type_front) FILTER (WHERE brake_type_front IS NOT NULL AND brake_type_front <> '') as brake_type_front,
        mode() WITHIN GROUP (ORDER BY brake_type_rear) FILTER (WHERE brake_type_rear IS NOT NULL AND brake_type_rear <> '') as brake_type_rear
    FROM vehicles WHERE year IS NOT NULL AND make IS NOT NULL AND model IS NOT NULL
    GROUP BY year, make, model
    """)
    cur.execute("CREATE INDEX ON _ymm_spec_lookup(year, make, model)")
    cur.execute("ANALYZE _ymm_spec_lookup")
    print(f"  Built: {cur.rowcount:,} combos ({time.time()-t0:.1f}s)", flush=True)

# =============================================================================
# Step 2: Per-field update, batched by Y/M/M combos
# =============================================================================
print("\nStep 2: Applying spec fills per field...", flush=True)
grand_total = 0


def process_field(field, null_check, is_text=False):
    global conn, cur, grand_total

    val_type = "text" if is_text else ("numeric" if field in ("fuel_capacity_gallons", "zero_to_sixty", "engine_liters") else "integer")
    t0 = time.time()

    # Fetch lookup combos that have this field
    cur.execute(f"SELECT year, make, model, {field} FROM _ymm_spec_lookup WHERE {field} IS NOT NULL")
    combos = cur.fetchall()

    if not combos:
        print(f"  {field}: 0 combos in lookup", flush=True)
        return

    field_total = 0
    skipped = 0

    for i in range(0, len(combos), COMBO_BATCH):
        batch = combos[i:i + COMBO_BATCH]
        try:
            execute_values(
                cur,
                f"""UPDATE vehicles v
                    SET {field} = data.val::{val_type}, updated_at = now()
                    FROM (VALUES %s) AS data(yr, mk, mdl, val)
                    WHERE v.year = data.yr::int AND v.make = data.mk AND v.model = data.mdl
                      AND {null_check}""",
                [(r[0], r[1], r[2], r[3]) for r in batch],
                template="(%s, %s, %s, %s)"
            )
            field_total += cur.rowcount
        except (psycopg2.errors.LockNotAvailable, psycopg2.errors.DeadlockDetected,
                psycopg2.errors.QueryCanceled):
            # Just skip this batch — no reconnect needed with autocommit
            skipped += len(batch)
        except psycopg2.errors.InFailedSqlTransaction:
            # Connection in bad state — must reconnect
            try: conn.close()
            except: pass
            conn, cur = get_conn()
            skipped += len(batch)

    elapsed = time.time() - t0
    grand_total += field_total
    rate = field_total / elapsed if elapsed > 0 else 0
    skip_msg = f", {skipped} combos skipped" if skipped else ""
    print(f"  {field}: {field_total:,} filled from {len(combos):,} combos ({elapsed:.1f}s, {rate:.0f}/s{skip_msg})", flush=True)


for field in NUM_FIELDS:
    process_field(field, f"v.{field} IS NULL", is_text=False)

for field in TEXT_FIELDS:
    process_field(field, f"(v.{field} IS NULL OR v.{field} = '')", is_text=True)

print(f"\n  Grand total: {grand_total:,} field-fills", flush=True)

# =============================================================================
# Step 3: OEM reference specs overlay
# =============================================================================
print("\nStep 3: OEM reference specs overlay...", flush=True)

OEM_MAP = [
    ("horsepower", "horsepower", True),
    ("torque", "torque_ft_lbs", True),
    ("weight_lbs", "curb_weight_lbs", True),
    ("doors", "doors", True),
    ("seats", "seats", True),
    ("wheelbase_inches", "wheelbase_inches", True),
    ("length_inches", "length_inches", True),
    ("width_inches", "width_inches", True),
    ("height_inches", "height_inches", True),
    ("mpg_city", "mpg_city", True),
    ("mpg_highway", "mpg_highway", True),
    ("fuel_capacity_gallons", "fuel_tank_gallons", True),
    ("engine_size", "engine_size", False),
    ("fuel_type", "fuel_type", False),
    ("drivetrain", "drivetrain", False),
    ("body_style", "body_style", False),
]

for veh_col, oem_col, is_num in OEM_MAP:
    null_check = f"v.{veh_col} IS NULL" if is_num else f"(v.{veh_col} IS NULL OR v.{veh_col} = '')"
    try:
        cur.execute(f"""
            UPDATE vehicles v
            SET {veh_col} = o.{oem_col}, updated_at = now()
            FROM oem_vehicle_specs o
            WHERE v.make = o.make AND v.model = o.model
              AND v.year BETWEEN o.year_start AND o.year_end
              AND {null_check}
              AND o.{oem_col} IS NOT NULL
        """)
        if cur.rowcount > 0:
            print(f"  {veh_col}: {cur.rowcount:,} from OEM", flush=True)
    except Exception as e:
        print(f"  {veh_col} OEM: {e}", flush=True)

# =============================================================================
# Step 4: Final coverage
# =============================================================================
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
      COUNT(fuel_capacity_gallons) as fuel_cap,
      COUNT(zero_to_sixty) as zero_to_sixty,
      COUNT(top_speed_mph) as top_speed,
      COUNT(engine_liters) as engine_liters,
      COUNT(transmission_speeds) as trans_speeds,
      COUNT(NULLIF(fuel_type,'')) as fuel_type,
      COUNT(NULLIF(body_style,'')) as body_style,
      COUNT(NULLIF(drivetrain,'')) as drivetrain,
      COUNT(NULLIF(engine_type,'')) as engine_type,
      COUNT(NULLIF(engine_size,'')) as engine_size,
      COUNT(NULLIF(transmission_type,'')) as trans_type,
      COUNT(NULLIF(steering_type,'')) as steering,
      COUNT(NULLIF(frame_type,'')) as frame_type,
      COUNT(NULLIF(suspension_front,'')) as susp_front,
      COUNT(NULLIF(suspension_rear,'')) as susp_rear,
      COUNT(NULLIF(brake_type_front,'')) as brake_front,
      COUNT(NULLIF(brake_type_rear,'')) as brake_rear
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
cur.execute("DROP TABLE IF EXISTS _ymm_spec_lookup")
conn.close()
print("\nDone!", flush=True)
