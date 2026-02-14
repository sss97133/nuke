#!/usr/bin/env python3
"""
Engine Spec Derivation — Direct database approach.

Parses engine_size text field to extract:
- displacement (numeric, liters)
- cylinders (integer)
- engine_configuration (V, inline, flat/boxer, rotary, etc.)

Then uses make/model/year + engine config to look up known horsepower/torque
from a built-in reference table of common engines.

Usage:
  python3 scripts/derive-engine-specs.py [--limit 200000] [--dry-run]
"""
import sys
import re
import time
import argparse
import math

try:
    import psycopg2
    from psycopg2.extras import execute_batch
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'psycopg2-binary', '-q'])
    import psycopg2
    from psycopg2.extras import execute_batch

DB_URL = "postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres"

# Cubic inches to liters conversion
CI_TO_LITERS = 0.016387064

# Word-to-number mapping for cylinder counts
WORD_CYLINDERS = {
    'twin': 2, 'two': 2,
    'three': 3,
    'four': 4, 'quad': 4,
    'five': 5,
    'six': 6,
    'eight': 8,
    'ten': 10,
    'twelve': 12,
    'sixteen': 16,
}

def parse_engine_string(engine_str):
    """Parse engine_size text into structured components."""
    if not engine_str or engine_str in ('N/A', 'n/a', 'NA', 'Unknown', 'Other'):
        return None

    result = {}
    s = engine_str.strip()

    # Strip leading modifiers
    s_clean = re.sub(r'^(?:Replacement|Rebuilt|Original|Modified|Upgraded|Stock|OEM)\s+', '', s, flags=re.I)

    # --- Extract displacement ---

    # Pattern 1: X.XL or X.X-Liter (liters)
    m = re.search(r'(\d+(?:\.\d+)?)\s*[-]?\s*(?:L(?:iter)?s?)\b', s_clean, re.I)
    if m:
        liters = float(m.group(1))
        if 0.1 < liters < 20:
            result['displacement'] = round(liters, 1)

    # Pattern 2: XXXci or XXX CI or XXX cubic inch (cubic inches)
    if 'displacement' not in result:
        m = re.search(r'(\d{2,4})\s*(?:ci|CI|cubic\s*inch(?:es)?|c\.i\.)', s_clean, re.I)
        if m:
            ci = int(m.group(1))
            if 50 < ci < 1200:
                result['displacement'] = round(ci * CI_TO_LITERS, 1)

    # Pattern 3: XXXcc (cc)
    if 'displacement' not in result:
        m = re.search(r'(\d{3,5})\s*cc\b', s_clean, re.I)
        if m:
            cc = int(m.group(1))
            if 100 < cc < 20000:
                result['displacement'] = round(cc / 1000, 1)

    # --- Extract configuration ---

    # V-engine
    m = re.search(r'\bV[-\s]?(\d{1,2})\b', s_clean, re.I)
    if m:
        cyl = int(m.group(1))
        if cyl in (2, 4, 6, 8, 10, 12, 16):
            result['cylinders'] = cyl
            result['config'] = 'V'

    # Inline / Straight
    if 'cylinders' not in result:
        m = re.search(r'\b(?:Inline|Straight|I)[-\s]?(\d{1,2})\b', s_clean, re.I)
        if m:
            cyl = int(m.group(1))
            if 2 <= cyl <= 8:
                result['cylinders'] = cyl
                result['config'] = 'Inline'

    # Flat / Boxer
    if 'cylinders' not in result:
        m = re.search(r'\b(?:Flat|Boxer)[-\s]?(\d{1,2})\b', s_clean, re.I)
        if m:
            cyl = int(m.group(1))
            if cyl in (2, 4, 6):
                result['cylinders'] = cyl
                result['config'] = 'Flat'

    # Word-based cylinder counts: "Flat-Six", "Inline-Four"
    if 'cylinders' not in result:
        for word, count in WORD_CYLINDERS.items():
            if re.search(rf'\b{word}\b', s_clean, re.I):
                result['cylinders'] = count
                # Try to detect config from context
                if re.search(r'\bflat|boxer\b', s_clean, re.I):
                    result['config'] = 'Flat'
                elif re.search(r'\binline|straight\b', s_clean, re.I):
                    result['config'] = 'Inline'
                elif count >= 6:
                    result['config'] = 'V'  # V6/V8/V10/V12 most common for larger
                break

    # X-cyl pattern
    if 'cylinders' not in result:
        m = re.search(r'(\d{1,2})[-\s]?cyl(?:inder)?s?\b', s_clean, re.I)
        if m:
            cyl = int(m.group(1))
            if 1 <= cyl <= 16:
                result['cylinders'] = cyl

    # Rotary / Wankel
    if re.search(r'\b(?:rotary|wankel|13B|12A|20B)\b', s_clean, re.I):
        result['config'] = 'Rotary'
        if 'cylinders' not in result:
            if re.search(r'\b(?:3[-\s]?rotor|20B)\b', s_clean, re.I):
                result['cylinders'] = 3
            else:
                result['cylinders'] = 2  # Most common: 2-rotor

    # Electric motor
    if re.search(r'\belectric\s+motor\b', s_clean, re.I):
        result['config'] = 'Electric'

    # Turbo / Supercharged detection
    if re.search(r'\bturbo(?:charged)?\b', s_clean, re.I):
        result['forced_induction'] = 'turbo'
    elif re.search(r'\bsupercharg(?:ed|er)\b', s_clean, re.I):
        result['forced_induction'] = 'supercharged'
    elif re.search(r'\btwin[-\s]?turbo\b', s_clean, re.I):
        result['forced_induction'] = 'twin-turbo'

    return result if result else None


# Known engine specs reference: (make_pattern, engine_pattern, years, hp, torque)
# This covers the most common engines found in collector vehicles
KNOWN_ENGINES = [
    # Porsche
    ('porsche', 3.6, 'Flat', 6, (1989, 1994), 247, 228),   # 964 3.6
    ('porsche', 3.6, 'Flat', 6, (1995, 1998), 282, 250),   # 993 3.6
    ('porsche', 3.6, 'Flat', 6, (1999, 2004), 320, 273),   # 996 3.6
    ('porsche', 3.8, 'Flat', 6, (2005, 2008), 355, 295),   # 997 3.8 S
    ('porsche', 3.2, 'Flat', 6, (1984, 1989), 231, 209),   # 3.2 Carrera
    ('porsche', 2.7, 'Flat', 6, (1974, 1977), 165, 167),   # 2.7
    ('porsche', 3.0, 'Flat', 6, (1978, 1983), 180, 175),   # SC 3.0
    ('porsche', 4.5, 'V', 8, (2003, 2006), 340, 310),      # Cayenne

    # BMW
    ('bmw', 3.0, 'Inline', 6, (2007, 2013), 300, 300),     # N54/N55
    ('bmw', 3.0, 'Inline', 6, (2001, 2006), 225, 214),     # M54
    ('bmw', 2.5, 'Inline', 6, (1991, 1995), 189, 181),     # M50
    ('bmw', 4.4, 'V', 8, (2002, 2005), 325, 330),          # N62
    ('bmw', 3.2, 'Inline', 6, (2001, 2006), 333, 262),     # S54 (M3)

    # Mercedes
    ('mercedes', 5.5, 'V', 8, (2007, 2011), 382, 391),     # M273
    ('mercedes', 3.0, 'V', 6, (2005, 2011), 228, 221),     # M272
    ('mercedes', 5.0, 'V', 8, (1998, 2006), 302, 339),     # M113
    ('mercedes', 6.3, 'V', 8, (2007, 2014), 451, 443),     # M156 AMG

    # Chevrolet / GM
    ('chevrolet', 5.7, 'V', 8, (1992, 1997), 300, 340),    # LT1
    ('chevrolet', 5.7, 'V', 8, (1997, 2004), 345, 350),    # LS1
    ('chevrolet', 6.2, 'V', 8, (2006, 2013), 430, 424),    # LS3
    ('chevrolet', 6.2, 'V', 8, (2014, 2019), 455, 460),    # LT1 (C7)
    ('chevrolet', 5.7, 'V', 8, (1967, 1991), 250, 300),    # Small Block 350 (base)
    ('chevrolet', 5.0, 'V', 8, (1987, 1995), 230, 300),    # 305

    # Ford
    ('ford', 5.0, 'V', 8, (2011, 2017), 420, 390),         # Coyote 5.0
    ('ford', 5.0, 'V', 8, (1986, 1995), 225, 300),         # 302 Windsor
    ('ford', 4.6, 'V', 8, (1996, 2004), 260, 302),         # 4.6 SOHC
    ('ford', 4.6, 'V', 8, (2005, 2010), 300, 320),         # 4.6 3V
    ('ford', 5.4, 'V', 8, (2005, 2010), 300, 365),         # 5.4 Triton

    # Dodge/Chrysler
    ('dodge', 5.7, 'V', 8, (2003, 2020), 370, 395),        # Hemi 5.7
    ('dodge', 6.4, 'V', 8, (2011, 2020), 485, 475),        # 392 Hemi
    ('dodge', 6.2, 'V', 8, (2015, 2023), 707, 650),        # Hellcat

    # Toyota
    ('toyota', 3.0, 'Inline', 6, (1986, 1992), 200, 188),  # 7M-GE
    ('toyota', 3.0, 'Inline', 6, (1993, 1998), 220, 210),  # 2JZ-GE
    ('toyota', 4.7, 'V', 8, (2000, 2009), 275, 332),       # 2UZ-FE

    # Mazda
    ('mazda', 1.3, 'Rotary', 2, (1993, 2002), 255, 217),   # 13B-REW (RX-7)
    ('mazda', 1.3, 'Rotary', 2, (2004, 2012), 232, 159),   # Renesis (RX-8)
    ('mazda', 2.0, 'Inline', 4, (2016, 2023), 181, 151),   # MX-5 ND
    ('mazda', 1.8, 'Inline', 4, (1994, 2005), 140, 119),   # MX-5 NB

    # Nissan/Datsun
    ('nissan', 3.0, 'V', 6, (1990, 1996), 300, 283),       # VG30DETT (300ZX TT)
    ('nissan', 2.6, 'Inline', 6, (1989, 2002), 276, 266),  # RB26DETT (GT-R)

    # Jaguar
    ('jaguar', 4.2, 'Inline', 6, (1965, 1987), 265, 283),  # XK 4.2
    ('jaguar', 5.3, 'V', 12, (1971, 1996), 295, 318),      # V12
    ('jaguar', 4.0, 'Inline', 6, (1988, 1997), 223, 249),  # AJ6/AJ16

    # Land Rover
    ('land rover', 4.0, 'V', 8, (1994, 2004), 190, 236),   # Rover V8
    ('land rover', 4.6, 'V', 8, (1999, 2004), 218, 300),   # Bosch 4.6

    # Volkswagen
    ('volkswagen', 1.6, 'Flat', 4, (1970, 1979), 50, 69),  # Air-cooled 1600
    ('volkswagen', 2.0, 'Inline', 4, (2006, 2014), 200, 207), # TSI
]


def lookup_hp_torque(make, year, displacement, config, cylinders):
    """Look up known HP/torque for a make/engine combination."""
    if not make or not year or not displacement:
        return None, None

    make_lower = make.lower().strip()
    # Handle make aliases
    aliases = {
        'chevy': 'chevrolet', 'gmc': 'chevrolet', 'pontiac': 'chevrolet',
        'oldsmobile': 'chevrolet', 'buick': 'chevrolet', 'cadillac': 'chevrolet',
        'chrysler': 'dodge', 'plymouth': 'dodge', 'ram': 'dodge', 'jeep': 'dodge',
        'lincoln': 'ford', 'mercury': 'ford',
        'lexus': 'toyota', 'scion': 'toyota',
        'infiniti': 'nissan', 'datsun': 'nissan',
        'audi': 'volkswagen',
        'mercedes-benz': 'mercedes',
    }
    make_normalized = aliases.get(make_lower, make_lower)

    best_hp = None
    best_torque = None
    best_score = 0

    for (eng_make, eng_disp, eng_config, eng_cyl, (yr_start, yr_end), hp, torque) in KNOWN_ENGINES:
        if eng_make != make_normalized:
            continue

        score = 0

        # Displacement match (within 0.2L tolerance)
        if displacement and abs(displacement - eng_disp) <= 0.2:
            score += 3
        elif displacement and abs(displacement - eng_disp) <= 0.5:
            score += 1
        else:
            continue  # Must match displacement roughly

        # Config match
        if config and eng_config and config == eng_config:
            score += 2

        # Cylinder match
        if cylinders and eng_cyl and cylinders == eng_cyl:
            score += 2

        # Year match
        if year and yr_start <= year <= yr_end:
            score += 3
        elif year and yr_start - 2 <= year <= yr_end + 2:
            score += 1

        if score > best_score:
            best_score = score
            best_hp = hp
            best_torque = torque

    # Only return if we have reasonable confidence (score >= 5)
    if best_score >= 5:
        return best_hp, best_torque
    return None, None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=200000)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor()

    print(f"[{time.strftime('%H:%M:%S')}] Finding vehicles with engine_size but missing specs...", file=sys.stderr)
    vehicles = []
    offset = 0
    page_size = 10000
    while len(vehicles) < args.limit:
        cur.execute("""
            SELECT id, engine_size, make, year, displacement, horsepower, torque
            FROM vehicles
            WHERE engine_size IS NOT NULL AND engine_size != '' AND engine_size != 'N/A'
              AND (displacement IS NULL OR horsepower IS NULL)
            ORDER BY id
            LIMIT %s OFFSET %s
        """, (page_size, offset))
        page = cur.fetchall()
        if not page:
            break
        vehicles.extend(page)
        offset += page_size
        print(f"  ... loaded {len(vehicles)} vehicles", file=sys.stderr)
    vehicles = vehicles[:args.limit]
    print(f"[{time.strftime('%H:%M:%S')}] Found {len(vehicles)} vehicles to process", file=sys.stderr)

    # Phase 1: Parse ALL engines locally (fast, no DB)
    print(f"[{time.strftime('%H:%M:%S')}] Parsing engine strings locally...", file=sys.stderr)
    start = time.time()
    disp_batch = []   # (vehicle_id, displacement_str)
    hp_batch = []     # (vehicle_id, hp, torque)
    parse_fails = 0

    for vid, engine_str, make, year, existing_disp, existing_hp, existing_torque in vehicles:
        parsed = parse_engine_string(engine_str)
        if not parsed:
            parse_fails += 1
            continue

        vehicle_id = str(vid)

        # Collect displacement updates
        if not existing_disp and parsed.get('displacement'):
            disp_batch.append((str(parsed['displacement']), vehicle_id))

        # Collect HP/torque updates
        displacement = existing_disp or (str(parsed['displacement']) if parsed.get('displacement') else None)
        if displacement and not existing_hp:
            try:
                disp_float = float(displacement)
            except (ValueError, TypeError):
                disp_float = None
            if disp_float:
                hp, torque = lookup_hp_torque(
                    make, year, disp_float,
                    parsed.get('config'), parsed.get('cylinders')
                )
                if hp:
                    hp_batch.append((hp, torque, vehicle_id))

    parse_time = time.time() - start
    print(f"[{time.strftime('%H:%M:%S')}] Parsed in {parse_time:.1f}s | "
          f"Displacement: {len(disp_batch)} | HP: {len(hp_batch)} | Parse fails: {parse_fails}", file=sys.stderr)

    if args.dry_run:
        print(f"DRY RUN — would update {len(disp_batch)} displacement + {len(hp_batch)} HP/torque", file=sys.stderr)
        conn.close()
        return

    # Phase 2: Execute batch UPDATEs (100 at a time)
    batch_size = 100
    errors = 0

    # Displacement updates
    print(f"[{time.strftime('%H:%M:%S')}] Writing {len(disp_batch)} displacement updates...", file=sys.stderr)
    for i in range(0, len(disp_batch), batch_size):
        chunk = disp_batch[i:i + batch_size]
        try:
            execute_batch(
                cur,
                "UPDATE vehicles SET displacement = COALESCE(displacement, %s) WHERE id = %s",
                chunk,
                page_size=batch_size
            )
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"Batch error (disp): {e}", file=sys.stderr)
        if (i // batch_size) % 10 == 0 and i > 0:
            print(f"  ... {i}/{len(disp_batch)} displacement written", file=sys.stderr)

    # HP/torque updates
    print(f"[{time.strftime('%H:%M:%S')}] Writing {len(hp_batch)} HP/torque updates...", file=sys.stderr)
    for i in range(0, len(hp_batch), batch_size):
        chunk = hp_batch[i:i + batch_size]
        try:
            execute_batch(
                cur,
                "UPDATE vehicles SET horsepower = COALESCE(horsepower, %s), torque = COALESCE(torque, %s) WHERE id = %s",
                chunk,
                page_size=batch_size
            )
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"Batch error (hp): {e}", file=sys.stderr)
        if (i // batch_size) % 10 == 0 and i > 0:
            print(f"  ... {i}/{len(hp_batch)} HP/torque written", file=sys.stderr)

    cur.close()
    conn.close()
    elapsed = time.time() - start
    print(f"\n[{time.strftime('%H:%M:%S')}] ===== COMPLETE =====", file=sys.stderr)
    print(f"Total parsed: {len(vehicles)} | Displacement filled: {len(disp_batch)} | HP filled: {len(hp_batch)}", file=sys.stderr)
    print(f"Parse fails: {parse_fails} | Errors: {errors}", file=sys.stderr)
    print(f"Duration: {int(elapsed//60)}m {int(elapsed%60)}s", file=sys.stderr)


if __name__ == '__main__':
    main()
