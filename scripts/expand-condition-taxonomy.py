#!/usr/bin/env python3
"""
Expand condition_taxonomy and condition_aliases from condition_knowledge.

Reads condition_knowledge entries, creates new taxonomy descriptors for
failure modes, and generates natural language aliases for YONO flag matching.

Usage:
  cd /Users/skylar/nuke
  dotenvx run -- python3 scripts/expand-condition-taxonomy.py [--dry-run]
"""

import os
import re
import sys
import json
import argparse
from pathlib import Path
from collections import defaultdict

import psycopg2
from psycopg2.extras import RealDictCursor

NUKE_DIR = Path("/Users/skylar/nuke")

TAXONOMY_VERSION = "v2_2026_03"

# System → condition_domain
SYSTEM_DOMAIN = {
    'frame': 'structural',
    'body': 'exterior',
    'steering': 'mechanical',
    'suspension': 'mechanical',
    'wheels': 'mechanical',
    'brakes': 'mechanical',
    'engine': 'mechanical',
    'fuel': 'mechanical',
    'exhaust': 'mechanical',
    'electrical': 'interior',
    'transmission': 'mechanical',
    'transfer_case': 'mechanical',
    'clutch': 'mechanical',
    'drivetrain': 'mechanical',
    'hvac': 'interior',
    'accessories': 'interior',
    'general': 'mechanical',
}

# Extra aliases for existing YONO flags (case variants + synonyms)
YONO_FLAG_ALIASES = {
    'rust': ['Rust', 'RUST', 'surface_rust', 'Surface_rust', 'corrosion', 'Corrosion',
             'oxidation', 'Oxidation', 'rust_spot', 'rust_spots', 'body_rust', 'frame_rust'],
    'paint_fade': ['Paint_fade', 'uv_fade', 'UV_fade', 'paint_oxidation', 'faded_paint',
                   'paint_fading', 'clearcoat_failure', 'paint_peel', 'paint_peeling'],
    'dent': ['Dent', 'ding', 'crease', 'body_damage', 'impact_damage', 'door_ding',
             'hail_damage', 'dented'],
    'scratch': ['Scratch', 'scrape', 'scuff', 'paint_scratch', 'key_scratch',
                'scratched', 'scratches'],
    'crack': ['Crack', 'cracked', 'hairline_crack', 'stress_crack', 'fatigue_crack'],
    'leak': ['Leak', 'leaking', 'oil_leak', 'fluid_leak', 'coolant_leak', 'seal_leak',
             'gasket_leak', 'drip', 'seepage'],
    'missing_parts': ['Missing_parts', 'missing_part', 'absent', 'removed', 'not_present'],
    'aftermarket': ['Aftermarket', 'non_original', 'non_oem', 'replacement',
                    'custom', 'modified_part'],
    'wear': ['Wear', 'worn', 'worn_out', 'excessive_wear', 'wear_pattern'],
    'rot': ['Rot', 'rotted', 'wood_rot', 'floor_rot', 'bed_rot', 'dry_rot'],
    'bent': ['Bent', 'twisted', 'warped', 'deformed', 'bent_frame'],
    'torn': ['Torn', 'ripped', 'damaged_upholstery', 'seat_tear', 'top_tear',
             'convertible_top_damage'],
    'stain': ['Stain', 'stained', 'water_stain', 'oil_stain', 'discoloration'],
    'chrome_pitting': ['Chrome_pitting', 'chrome_damage', 'pitted_chrome', 'bumper_pitting'],
    'glass_crack': ['Glass_crack', 'windshield_crack', 'window_crack', 'chipped_glass'],
    'tire_wear': ['Tire_wear', 'bald_tire', 'worn_tire', 'uneven_wear', 'tire_dry_rot'],
    'exhaust_smoke': ['Exhaust_smoke', 'smoking', 'blue_smoke', 'white_smoke', 'black_smoke'],
    'oil_consumption': ['Oil_consumption', 'burning_oil', 'oil_burning'],
    'compression_loss': ['Compression_loss', 'low_compression', 'blow_by'],
    'overheating': ['Overheating', 'overheat', 'running_hot', 'hot_engine'],
    'vibration': ['Vibration', 'shake', 'shimmy', 'wheel_shake', 'steering_vibration'],
    'noise': ['Noise', 'rattle', 'squeak', 'knock', 'grinding', 'clunk',
              'whine', 'clicking', 'ticking'],
    'pull': ['Pull', 'pulling', 'drift', 'wander', 'steering_pull'],
    'rough_idle': ['Rough_idle', 'idle_problem', 'misfire', 'rough_running'],
    'hard_start': ['Hard_start', 'starting_problem', 'no_start', 'cranks_no_start'],
    'brake_fade': ['Brake_fade', 'soft_brakes', 'spongy_brakes', 'poor_braking'],
    'clutch_slip': ['Clutch_slip', 'slipping_clutch', 'clutch_worn'],
    'gear_grind': ['Gear_grind', 'grinding_gears', 'synchro_worn', 'hard_shift'],
    'lift_kit': ['Lift_kit', 'lifted', 'suspension_lift', 'body_lift'],
    'lowered': ['Lowered', 'slammed', 'dropped', 'lowering_kit'],
    'custom_wheels': ['Custom_wheels', 'aftermarket_wheels', 'upgraded_wheels'],
    'roll_bar': ['Roll_bar', 'roll_cage', 'light_bar'],
    'winch': ['Winch', 'front_winch', 'bumper_winch'],
    'brush_guard': ['Brush_guard', 'bull_bar', 'push_bar', 'grille_guard'],
    'tonneau_cover': ['Tonneau_cover', 'bed_cover', 'truck_bed_cover'],
    'running_boards': ['Running_boards', 'side_steps', 'nerf_bars'],
    'original': ['Original', 'OEM', 'factory', 'stock', 'numbers_matching'],
    'restored': ['Restored', 'restoration', 'frame_off', 'frame_on',
                 'nut_and_bolt', 'concours'],
    'patina': ['Patina', 'natural_patina', 'aged', 'survivor'],
}


def get_connection():
    db_pass = os.environ.get("SUPABASE_DB_PASSWORD")
    if not db_pass:
        for line in (NUKE_DIR / ".env").read_text().splitlines():
            if line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip('"').strip("'"))
        db_pass = os.environ.get("SUPABASE_DB_PASSWORD")
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        db_url = (
            f"postgresql://postgres.qkgaybvrernstplzjaam:{db_pass}"
            f"@aws-0-us-west-1.pooler.supabase.com:6543/postgres"
            f"?sslmode=require"
        )
    try:
        return psycopg2.connect(db_url, connect_timeout=15)
    except psycopg2.OperationalError:
        # DNS fallback — connect via resolved pooler IP
        return psycopg2.connect(
            host="52.8.172.168", port=6543,
            user="postgres.qkgaybvrernstplzjaam",
            password=db_pass, dbname="postgres",
            sslmode="require", connect_timeout=15,
        )


def make_canonical_key(domain: str, system: str, component: str, symptom_slug: str) -> str:
    """Build a dot-notation canonical key."""
    # Clean up the symptom slug
    slug = symptom_slug.lower().strip()
    slug = re.sub(r'[^a-z0-9_]', '_', slug)
    slug = re.sub(r'_+', '_', slug)
    slug = slug.strip('_')[:40]
    return f"{domain}.{component}.{slug}"


def symptom_to_slug(symptom: str) -> str:
    """Convert a symptom description to a short slug."""
    if not symptom:
        return "general"

    # Common symptom → slug mappings
    slug_map = [
        (r'noise|rattle|squeak|knock', 'noise'),
        (r'leak|leaking|seep', 'leak'),
        (r'wear|worn', 'wear'),
        (r'crack|broken|break', 'crack'),
        (r'loose|play|slack', 'loose'),
        (r'hard\s+(shift|steer|brak)', 'stiff'),
        (r'pull|drift|wander', 'pull'),
        (r'vibrat|shake|shimmy', 'vibration'),
        (r'overheat|hot', 'overheat'),
        (r'slip|slipping', 'slip'),
        (r'inoperative|fail|not\s+work', 'inoperative'),
        (r'low\s+press|no\s+press', 'low_pressure'),
        (r'excessive|too\s+much', 'excessive'),
        (r'insufficient|poor|inadequate', 'insufficient'),
        (r'misalign|alignment', 'misalignment'),
        (r'corrosi|rust|oxidiz', 'corrosion'),
        (r'contaminat|dirty', 'contaminated'),
        (r'stuck|bind|seized', 'stuck'),
    ]

    symptom_lower = symptom.lower()
    for pattern, slug in slug_map:
        if re.search(pattern, symptom_lower):
            return slug

    # Default: first 3 significant words
    words = re.findall(r'[a-z]+', symptom_lower)
    stopwords = {'the', 'a', 'an', 'in', 'on', 'of', 'or', 'and', 'to', 'is', 'are', 'was'}
    words = [w for w in words if w not in stopwords][:3]
    return '_'.join(words) if words else 'general'


def generate_aliases_from_symptom(canonical_key: str, symptom: str, component: str) -> list:
    """Generate natural language aliases that YONO might produce."""
    aliases = set()

    if not symptom:
        return []

    # Extract key words from the symptom
    symptom_lower = symptom.lower()

    # Component + condition combos
    condition_words = ['noise', 'leak', 'wear', 'crack', 'loose', 'vibration',
                       'pull', 'slip', 'overheat', 'rust', 'corrosion', 'bent',
                       'broken', 'missing', 'worn', 'stiff', 'binding', 'inoperative']

    for word in condition_words:
        if word in symptom_lower:
            aliases.add(f"{component}_{word}")
            aliases.add(word)

    # YONO commonly produces component_condition flags
    comp = component.replace(' ', '_')
    slug = symptom_to_slug(symptom)
    aliases.add(f"{comp}_{slug}")

    return sorted(aliases)


def main():
    parser = argparse.ArgumentParser(description="Expand condition taxonomy from knowledge base")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = parser.parse_args()

    os.chdir(NUKE_DIR)
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Load existing taxonomy
    cur.execute("SELECT descriptor_id, canonical_key, domain FROM condition_taxonomy")
    existing_keys = {r["canonical_key"]: str(r["descriptor_id"]) for r in cur.fetchall()}
    print(f"Existing taxonomy: {len(existing_keys)} descriptors")

    # Load existing aliases
    cur.execute("SELECT alias_key, descriptor_id FROM condition_aliases")
    existing_aliases = {r["alias_key"]: str(r["descriptor_id"]) for r in cur.fetchall()}
    print(f"Existing aliases: {len(existing_aliases)} entries")

    # Load condition knowledge
    cur.execute("""
        SELECT system, component, sub_component, condition_type,
               symptom, severity_class, condition_domain
        FROM condition_knowledge
        WHERE condition_type = 'failure_mode'
    """)
    failure_modes = cur.fetchall()
    print(f"Failure modes from knowledge base: {len(failure_modes)}")

    # ── Phase 1: Create new taxonomy descriptors ──────────────────

    new_descriptors = {}  # canonical_key → descriptor dict
    new_aliases = {}      # alias_key → canonical_key

    # Create baseline descriptors for each domain (so scoring doesn't default to 50%)
    for domain in ['interior', 'mechanical', 'structural', 'provenance']:
        key = f"{domain}.assessed.baseline"
        if key not in existing_keys and key not in new_descriptors:
            new_descriptors[key] = {
                "canonical_key": key,
                "domain": domain,
                "descriptor_type": "state",
                "display_label": f"{domain.title()} Assessed Baseline",
            }

    # Group failure modes by system+component+slug to deduplicate
    seen_keys = set()

    def is_valid_symptom(symptom: str) -> bool:
        """Filter out OCR junk and non-meaningful symptom text."""
        if not symptom or len(symptom) < 8:
            return False
        # OCR artifacts: excessive spaces, single-char words
        words = symptom.split()
        if len(words) < 2:
            return False
        # Too many single-char "words" = OCR garbage
        single_char = sum(1 for w in words if len(w) <= 2)
        if single_char > len(words) * 0.5:
            return False
        # Must contain at least one real word (3+ letters)
        real_words = [w for w in words if len(w) >= 3 and w.isalpha()]
        if len(real_words) < 1:
            return False
        # Known OCR garbage patterns
        if re.match(r'^[A-Z\s]{2,}$', symptom) and len(symptom) < 20:
            return False  # All-caps fragments like "NORM AL AIR"
        # Filter out symptoms that look like instruction fragments
        junk_starts = ['check for', 'see checking', 'chart for', 'from blower',
                       'evacuate', 'if pipes', 'glass.', 'system see',
                       'does not light', 't. check']
        for j in junk_starts:
            if symptom.lower().startswith(j):
                return False
        return True

    for fm in failure_modes:
        if not is_valid_symptom(fm["symptom"]):
            continue
        domain = fm["condition_domain"]
        component = fm["component"]
        slug = symptom_to_slug(fm["symptom"])
        canonical_key = make_canonical_key(domain, fm["system"], component, slug)

        if canonical_key in existing_keys or canonical_key in new_descriptors or canonical_key in seen_keys:
            continue
        seen_keys.add(canonical_key)

        # Determine descriptor_type based on severity
        if fm["severity_class"] in ("safety_critical", "structural"):
            desc_type = "mechanism"
        else:
            desc_type = "adjective"

        # Build display label
        display = f"{component.replace('_', ' ').title()} {slug.replace('_', ' ').title()}"

        new_descriptors[canonical_key] = {
            "canonical_key": canonical_key,
            "domain": domain,
            "descriptor_type": desc_type,
            "display_label": display,
        }

        # Generate aliases for this descriptor
        aliases = generate_aliases_from_symptom(canonical_key, fm["symptom"], component)
        for alias in aliases:
            if alias not in existing_aliases and alias not in new_aliases:
                new_aliases[alias] = canonical_key

    # ── Phase 2: Add YONO flag aliases ──────────────────────────

    # For each YONO flag, find its existing descriptor and add case variants
    yono_alias_count = 0
    for base_flag, variants in YONO_FLAG_ALIASES.items():
        # Find the descriptor for the base flag
        descriptor_id = existing_aliases.get(base_flag)

        if not descriptor_id:
            # Check if any variant already exists
            for v in variants:
                if v in existing_aliases:
                    descriptor_id = existing_aliases[v]
                    break

        if not descriptor_id:
            # No existing descriptor for this flag — create one
            # Guess domain from flag name
            domain = 'exterior'  # default
            desc_type = 'adjective'
            if base_flag in ('noise', 'vibration', 'rough_idle', 'hard_start',
                             'exhaust_smoke', 'oil_consumption', 'compression_loss',
                             'overheating', 'brake_fade', 'clutch_slip', 'gear_grind'):
                domain = 'mechanical'
            elif base_flag in ('stain', 'torn'):
                domain = 'interior'
            elif base_flag in ('lift_kit', 'lowered', 'custom_wheels', 'roll_bar',
                               'winch', 'brush_guard', 'tonneau_cover', 'running_boards'):
                desc_type = 'state'  # modifications
            elif base_flag in ('original', 'restored', 'patina'):
                domain = 'provenance'
                desc_type = 'state'

            key = f"{domain}.flag.{base_flag}"
            if key not in existing_keys and key not in new_descriptors:
                new_descriptors[key] = {
                    "canonical_key": key,
                    "domain": domain,
                    "descriptor_type": desc_type,
                    "display_label": base_flag.replace('_', ' ').title(),
                    "_base_flag": base_flag,
                }
                # The base flag itself becomes an alias to this new descriptor
                new_aliases[base_flag] = key

        # Add all variants as aliases
        for variant in variants:
            if variant not in existing_aliases and variant not in new_aliases:
                if descriptor_id:
                    new_aliases[variant] = descriptor_id  # Direct UUID
                else:
                    new_aliases[variant] = f"exterior.flag.{base_flag}"  # canonical key ref
                yono_alias_count += 1

    # ── Phase 3: Write to database ─────────────────────────────

    print(f"\nNew descriptors to create: {len(new_descriptors)}")
    print(f"New aliases to create: {len(new_aliases)}")
    print(f"  (of which {yono_alias_count} are YONO flag variants)")

    if args.dry_run:
        print("\n[DRY RUN] Sample new descriptors:")
        for key, desc in list(new_descriptors.items())[:15]:
            print(f"  {desc['domain']:12s} {desc['descriptor_type']:10s} {key}")

        print("\n[DRY RUN] Sample new aliases:")
        for alias, target in list(new_aliases.items())[:15]:
            print(f"  {alias:30s} → {target[:50]}")
        conn.close()
        return

    # Write descriptors
    created_descriptors = {}  # canonical_key → descriptor_id
    wcur = conn.cursor(cursor_factory=RealDictCursor)

    for key, desc in new_descriptors.items():
        try:
            wcur.execute("""
                INSERT INTO condition_taxonomy
                    (canonical_key, domain, descriptor_type, display_label, taxonomy_version)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (canonical_key) DO NOTHING
                RETURNING descriptor_id
            """, (
                desc["canonical_key"],
                desc["domain"],
                desc["descriptor_type"],
                desc["display_label"],
                TAXONOMY_VERSION,
            ))
            row = wcur.fetchone()
            if row:
                created_descriptors[key] = str(row["descriptor_id"])
        except Exception as e:
            print(f"  Error creating descriptor {key}: {e}")
            conn.rollback()

    conn.commit()
    print(f"Created {len(created_descriptors)} new descriptors")

    # Reload full alias map (existing + newly created)
    wcur.execute("SELECT canonical_key, descriptor_id FROM condition_taxonomy")
    all_descriptors = {r["canonical_key"]: str(r["descriptor_id"]) for r in wcur.fetchall()}

    # Write aliases
    alias_written = 0
    for alias_key, target in new_aliases.items():
        # Resolve target to descriptor_id
        descriptor_id = None
        if len(target) == 36 and '-' in target:  # UUID
            descriptor_id = target
        else:
            descriptor_id = all_descriptors.get(target)

        if not descriptor_id:
            continue

        try:
            wcur.execute("""
                INSERT INTO condition_aliases (alias_key, descriptor_id, taxonomy_version)
                VALUES (%s, %s, %s)
                ON CONFLICT (alias_key) DO NOTHING
            """, (alias_key, descriptor_id, TAXONOMY_VERSION))
            if wcur.rowcount > 0:
                alias_written += 1
        except Exception as e:
            print(f"  Error creating alias {alias_key}: {e}")
            conn.rollback()

    conn.commit()
    wcur.close()

    print(f"Created {alias_written} new aliases")

    # Final counts
    cur.execute("SELECT count(*) as cnt FROM condition_taxonomy")
    total_desc = cur.fetchone()["cnt"]
    cur.execute("SELECT count(*) as cnt FROM condition_aliases")
    total_alias = cur.fetchone()["cnt"]

    print(f"\nFinal taxonomy: {total_desc} descriptors, {total_alias} aliases")

    # Domain distribution
    cur.execute("SELECT domain, count(*) as cnt FROM condition_taxonomy GROUP BY domain ORDER BY cnt DESC")
    print("\nDescriptors by domain:")
    for r in cur.fetchall():
        print(f"  {r['domain']:15s} {r['cnt']}")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
