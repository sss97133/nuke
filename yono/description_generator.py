#!/usr/bin/env python3
"""
Description Generator — Rich per-image descriptions and session narratives.

Pass 1: Florence-2 raw captions (handled in modal_batch.py _write_results)
Pass 2: Contextual descriptions (Florence-2 with vehicle/session context)
Pass 3: Session-refined descriptions (Claude Haiku, high-value vehicles only)

Session Narratives: Per-session story generation from aggregated descriptions.

Usage:
  cd /Users/skylar/nuke

  # Generate pass-2 contextual descriptions for a vehicle's sessions
  python3 -m yono.description_generator contextual --vehicle-id UUID

  # Generate session narrative for a specific session
  python3 -m yono.description_generator narrative --session-id UUID

  # Generate narratives for all sessions of a vehicle
  python3 -m yono.description_generator narratives --vehicle-id UUID

  # Batch: generate pass-2 descriptions for vehicles with sessions
  python3 -m yono.description_generator contextual-all --limit 100

  # Stats
  python3 -m yono.description_generator stats
"""

import os
import json
import time
from pathlib import Path
from datetime import datetime
from typing import Optional

import psycopg2
from psycopg2.extras import RealDictCursor

NUKE_DIR = Path("/Users/skylar/nuke")


# ─── DB Connection ──────────────────────────────────────────────────

def get_connection():
    """Get database connection (same pattern as condition_spectrometer)."""
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        db_pass = os.environ.get("SUPABASE_DB_PASSWORD")
        if not db_pass:
            for line in (NUKE_DIR / ".env").read_text().splitlines():
                if line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip('"').strip("'"))
            db_pass = os.environ.get("SUPABASE_DB_PASSWORD")
        if db_pass:
            db_url = (
                f"postgresql://postgres.qkgaybvrernstplzjaam:{db_pass}"
                f"@aws-0-us-west-1.pooler.supabase.com:6543/postgres"
                f"?sslmode=require"
            )
        else:
            raise RuntimeError("SUPABASE_DB_PASSWORD not set")
    elif "sslmode" not in db_url:
        db_url += "?sslmode=require" if "?" not in db_url else "&sslmode=require"
    return psycopg2.connect(db_url, connect_timeout=30)


# ─── Pass 2: Contextual Descriptions ───────────────────────────────

def generate_contextual_descriptions(conn, vehicle_id: str) -> dict:
    """
    Generate pass-2 contextual descriptions for images in auto-sessions.
    Uses vehicle Y/M/M context, session type, and neighbor images to enrich
    raw Florence-2 captions into contextual descriptions.
    """
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '60s'")

    # Get vehicle context
    cur.execute("""
        SELECT year, make, model, vin, color, mileage, engine_type, sale_price,
               CONCAT(year, '_', make, '_', model) AS ymm_key
        FROM vehicles WHERE id = %s
    """, (vehicle_id,))
    vehicle = cur.fetchone()
    if not vehicle:
        cur.close()
        return {"vehicle_id": vehicle_id, "status": "vehicle_not_found"}

    # Normalize ymm_key with suffix stripping (matches coalesced ymm_knowledge keys)
    ymm_key = None
    if vehicle["year"] and vehicle["make"]:
        from yono.contextual_training.build_ymm_knowledge import strip_model_suffix
        base_model, _ = strip_model_suffix(vehicle["model"] or '')
        ymm_key = f"{vehicle['year']}_{vehicle['make']}_{base_model}"
    ymm_label = f"{vehicle['year'] or '?'} {vehicle['make'] or '?'} {vehicle['model'] or '?'}"

    # Get all auto-sessions with their images
    cur.execute("""
        SELECT s.id AS session_id, s.session_type_key, s.name AS session_name,
               ARRAY_AGG(m.image_id ORDER BY m.display_order) AS image_ids
        FROM image_sets s
        JOIN image_set_members m ON m.image_set_id = s.id
        WHERE s.vehicle_id = %s AND s.is_auto_session = true
        GROUP BY s.id
        ORDER BY s.session_start ASC NULLS LAST
    """, (vehicle_id,))
    sessions = cur.fetchall()

    if not sessions:
        cur.close()
        return {"vehicle_id": vehicle_id, "status": "no_sessions", "descriptions": 0}

    total_descriptions = 0

    for session in sessions:
        session_id = str(session["session_id"])
        image_ids = session["image_ids"]
        session_type = session["session_type_key"] or "unknown"
        session_name = session["session_name"]

        # Get image details + pass-1 descriptions
        cur.execute("""
            SELECT vi.id, vi.vehicle_zone, vi.condition_score, vi.damage_flags,
                   vi.modification_flags, vi.source,
                   d.description AS pass1_caption, d.id AS desc_id
            FROM vehicle_images vi
            LEFT JOIN LATERAL (
                SELECT id, description FROM image_descriptions
                WHERE image_id = vi.id AND pass_number = 1
                ORDER BY created_at DESC LIMIT 1
            ) d ON true
            WHERE vi.id = ANY(%s)
            ORDER BY COALESCE(vi.taken_at, vi.created_at) ASC
        """, (image_ids,))
        images = cur.fetchall()

        for idx, img in enumerate(images):
            image_id = str(img["id"])
            pass1 = img["pass1_caption"] or ""

            # Check if pass-2 already exists
            cur.execute("""
                SELECT id FROM image_descriptions
                WHERE image_id = %s AND pass_number = 2
                LIMIT 1
            """, (image_id,))
            if cur.fetchone():
                continue  # Already has pass-2

            # Build contextual description
            zone = img["vehicle_zone"] or "unspecified area"
            position = f"Photo {idx + 1} of {len(images)}"
            damage = img["damage_flags"] or []
            mods = img["modification_flags"] or []

            # Neighbor context
            prev_zone = images[idx - 1]["vehicle_zone"] if idx > 0 else None
            next_zone = images[idx + 1]["vehicle_zone"] if idx < len(images) - 1 else None
            neighbor_ids = []
            if idx > 0:
                neighbor_ids.append(str(images[idx - 1]["id"]))
            if idx < len(images) - 1:
                neighbor_ids.append(str(images[idx + 1]["id"]))

            # Build enriched description from raw caption + context
            parts = []
            parts.append(f"{ymm_label} — {zone.replace('_', ' ')}")
            if pass1:
                parts.append(pass1)
            parts.append(f"({position} in {session_name})")
            if damage:
                parts.append(f"Damage noted: {', '.join(d.replace('_', ' ') for d in damage)}")
            if mods:
                parts.append(f"Modifications: {', '.join(m.replace('_', ' ') for m in mods)}")

            # Sequence context
            if prev_zone and next_zone:
                parts.append(f"Sequence: {prev_zone.replace('_',' ')} → {zone.replace('_',' ')} → {next_zone.replace('_',' ')}")

            description = ". ".join(parts)

            cur.execute("""
                INSERT INTO image_descriptions (
                    image_id, vehicle_id, session_id, description,
                    description_type, context_ymm_key, context_session_type,
                    context_neighbor_ids, source, source_version,
                    pass_number, confidence
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::uuid[], %s, %s, %s, %s)
            """, (
                image_id, vehicle_id, session_id, description,
                "contextual", ymm_key, session_type,
                neighbor_ids if neighbor_ids else None,
                "contextual_enrichment", "v1_2026_03",
                2, 0.7,
            ))
            total_descriptions += 1

    conn.commit()
    cur.close()

    return {
        "vehicle_id": vehicle_id,
        "status": "completed",
        "sessions_processed": len(sessions),
        "descriptions": total_descriptions,
    }


# ─── Session Narratives ────────────────────────────────────────────

def generate_session_narrative(conn, session_id: str) -> dict:
    """
    Generate a narrative for a session from its image descriptions.
    Uses rule-based template (pass 1). Claude Haiku (pass 2) reserved
    for high-value vehicles.
    """
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '30s'")

    # Get session info
    cur.execute("""
        SELECT s.id, s.vehicle_id, s.name, s.session_type_key,
               s.session_start, s.session_end, s.session_duration_minutes,
               s.session_location, s.predecessor_session_id, s.successor_session_id,
               v.year, v.make, v.model, v.sale_price, v.condition_rating
        FROM image_sets s
        JOIN vehicles v ON v.id = s.vehicle_id
        WHERE s.id = %s
    """, (session_id,))
    session = cur.fetchone()
    if not session:
        cur.close()
        return {"session_id": session_id, "status": "not_found"}

    vehicle_id = str(session["vehicle_id"])
    ymm = f"{session['year'] or '?'} {session['make'] or '?'} {session['model'] or '?'}"
    session_type = session["session_type_key"] or "unknown"

    # Get image descriptions (best pass per image)
    cur.execute("""
        SELECT DISTINCT ON (d.image_id) d.id, d.description, d.pass_number,
               vi.vehicle_zone, vi.damage_flags, vi.condition_score
        FROM image_descriptions d
        JOIN vehicle_images vi ON vi.id = d.image_id
        WHERE d.session_id = %s
        ORDER BY d.image_id, d.pass_number DESC
    """, (session_id,))
    descriptions = cur.fetchall()

    # Fallback: if no descriptions linked to session, get by image membership
    if not descriptions:
        cur.execute("""
            SELECT DISTINCT ON (d.image_id) d.id, d.description, d.pass_number,
                   vi.vehicle_zone, vi.damage_flags, vi.condition_score
            FROM image_set_members m
            JOIN image_descriptions d ON d.image_id = m.image_id
            JOIN vehicle_images vi ON vi.id = m.image_id
            WHERE m.image_set_id = %s
            ORDER BY d.image_id, d.pass_number DESC
        """, (session_id,))
        descriptions = cur.fetchall()

    # Get member count
    cur.execute("SELECT COUNT(*) as cnt FROM image_set_members WHERE image_set_id = %s", (session_id,))
    member_count = cur.fetchone()["cnt"]

    # Get predecessor summary
    pred_summary = None
    if session["predecessor_session_id"]:
        cur.execute("""
            SELECT name, session_type_key FROM image_sets WHERE id = %s
        """, (str(session["predecessor_session_id"]),))
        pred = cur.fetchone()
        if pred:
            pred_summary = f"{pred['name']} ({pred['session_type_key']})"

    # Build narrative from descriptions
    date_str = session["session_start"].strftime("%B %d, %Y") if session["session_start"] else "an unknown date"
    duration = session["session_duration_minutes"]

    # Collect zones and conditions
    zones = [d["vehicle_zone"] for d in descriptions if d.get("vehicle_zone")]
    zone_set = set(zones)
    damage_found = set()
    for d in descriptions:
        if d.get("damage_flags"):
            damage_found.update(d["damage_flags"])

    # Session type-specific narrative templates
    type_templates = {
        "walkaround": f"A walkaround inspection of this {ymm} on {date_str}, documenting {member_count} photos across {len(zone_set)} distinct angles.",
        "damage_documentation": f"Damage documentation session on {date_str} for this {ymm}, capturing {member_count} photos of {', '.join(d.replace('_', ' ') for d in damage_found) if damage_found else 'various areas'}.",
        "paint_body_work": f"Paint and body work session on {date_str} for this {ymm}. {member_count} photos document the work in progress.",
        "engine_rebuild": f"Engine and mechanical work session on {date_str} for this {ymm}. {member_count} photos document the engine bay and mechanical components.",
        "interior_restoration": f"Interior restoration session on {date_str} for this {ymm}. {member_count} photos capture upholstery, trim, and interior detail work.",
        "detail_show_prep": f"Detail and show preparation session on {date_str} for this {ymm}. {member_count} photos capture the final polish and presentation.",
        "auction_listing": f"Auction listing photo shoot for this {ymm}, taken on {date_str}. A systematic {member_count}-photo set covering all major angles.",
        "delivery_transport": f"Transport documentation for this {ymm} on {date_str}. {member_count} photos document the delivery.",
        "comparison_before_after": f"Before-and-after comparison photos of this {ymm} from {date_str}, showing transformation progress.",
        "road_trip_driving": f"Driving photos of this {ymm} from {date_str}. {member_count} photos captured on the road.",
        "casual_lifestyle": f"Casual photos of this {ymm} from {date_str}.",
        "detail_closeup": f"Detail close-up session of this {ymm} from {date_str}. {member_count} photos examine specific features and details.",
        "parts_reference": f"Parts reference photos for this {ymm} from {date_str}. {member_count} photos document individual components.",
    }

    narrative = type_templates.get(session_type,
        f"Photo session for this {ymm} on {date_str}. {member_count} photos captured.")

    # Add duration context
    if duration and duration > 1:
        narrative += f" Session lasted approximately {int(duration)} minutes."

    # Add condition context
    avg_condition = None
    condition_scores = [d["condition_score"] for d in descriptions if d.get("condition_score")]
    if condition_scores:
        avg_condition = sum(condition_scores) / len(condition_scores)
        if avg_condition >= 4:
            narrative += " Overall condition appears strong."
        elif avg_condition <= 2:
            narrative += " Significant wear or damage is evident."

    # Add continuity
    continuity_note = None
    if pred_summary:
        continuity_note = f"Follows: {pred_summary}"
        narrative += f" This session follows the earlier {pred_summary}."

    # Key observations
    key_observations = []
    if zone_set:
        key_observations.append(f"Zones covered: {', '.join(z.replace('_', ' ') for z in sorted(zone_set))}")
    if damage_found:
        key_observations.append(f"Damage: {', '.join(d.replace('_', ' ') for d in sorted(damage_found))}")
    if avg_condition:
        key_observations.append(f"Avg condition score: {avg_condition:.1f}/5")

    # Collect description IDs used
    desc_ids = [str(d["id"]) for d in descriptions]

    # Insert narrative
    cur.execute("""
        INSERT INTO session_narratives (
            session_id, vehicle_id, narrative, summary,
            key_observations, session_type_key, continuity_note,
            source, pass_number, confidence, image_descriptions_used
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::uuid[])
        RETURNING id
    """, (
        session_id, vehicle_id, narrative,
        narrative[:200],  # summary = truncated narrative
        key_observations, session_type, continuity_note,
        "session_detector_rule", 1, 0.6, desc_ids if desc_ids else None,
    ))
    narrative_id = str(cur.fetchone()["id"])

    # Denormalize to image_sets.narrative
    cur.execute("""
        UPDATE image_sets SET narrative = %s, narrative_version = 'rule_v1'
        WHERE id = %s
    """, (narrative, session_id))

    conn.commit()
    cur.close()

    return {
        "session_id": session_id,
        "narrative_id": narrative_id,
        "narrative": narrative,
        "key_observations": key_observations,
        "continuity_note": continuity_note,
        "descriptions_used": len(desc_ids),
        "status": "generated",
    }


def generate_vehicle_narratives(conn, vehicle_id: str) -> dict:
    """Generate narratives for all auto-sessions of a vehicle."""
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '30s'")
    cur.execute("""
        SELECT id FROM image_sets
        WHERE vehicle_id = %s AND is_auto_session = true
        ORDER BY session_start ASC NULLS LAST
    """, (vehicle_id,))
    sessions = cur.fetchall()
    cur.close()

    results = []
    for s in sessions:
        try:
            result = generate_session_narrative(conn, str(s["id"]))
            results.append(result)
        except Exception as e:
            results.append({"session_id": str(s["id"]), "status": "error", "error": str(e)})

    return {
        "vehicle_id": vehicle_id,
        "narratives_generated": sum(1 for r in results if r.get("status") == "generated"),
        "errors": sum(1 for r in results if r.get("status") == "error"),
        "results": results,
    }


# ─── Stats ──────────────────────────────────────────────────────────

def get_description_stats(conn) -> dict:
    """Get global description/narrative statistics."""
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '30s'")

    cur.execute("""
        SELECT
            COUNT(*) AS total_descriptions,
            COUNT(*) FILTER (WHERE pass_number = 1) AS pass_1,
            COUNT(*) FILTER (WHERE pass_number = 2) AS pass_2,
            COUNT(*) FILTER (WHERE pass_number = 3) AS pass_3,
            COUNT(DISTINCT image_id) AS images_described,
            COUNT(DISTINCT vehicle_id) AS vehicles_described
        FROM image_descriptions
    """)
    desc_stats = dict(cur.fetchone())

    cur.execute("""
        SELECT
            COUNT(*) AS total_narratives,
            COUNT(DISTINCT session_id) AS sessions_narrated,
            COUNT(DISTINCT vehicle_id) AS vehicles_narrated
        FROM session_narratives
    """)
    narr_stats = dict(cur.fetchone())

    cur.close()
    return {**desc_stats, **narr_stats}


# ─── CLI ────────────────────────────────────────────────────────────

def main():
    import argparse

    parser = argparse.ArgumentParser(description="YONO Description Generator")
    sub = parser.add_subparsers(dest="command", required=True)

    # contextual
    p_ctx = sub.add_parser("contextual", help="Generate pass-2 contextual descriptions")
    p_ctx.add_argument("--vehicle-id", required=True)

    # narrative
    p_narr = sub.add_parser("narrative", help="Generate narrative for a session")
    p_narr.add_argument("--session-id", required=True)

    # narratives
    p_narrs = sub.add_parser("narratives", help="Generate narratives for all vehicle sessions")
    p_narrs.add_argument("--vehicle-id", required=True)

    # contextual-all
    p_all = sub.add_parser("contextual-all", help="Batch contextual descriptions")
    p_all.add_argument("--limit", type=int, default=100)

    # stats
    sub.add_parser("stats", help="Show description statistics")

    args = parser.parse_args()
    conn = get_connection()

    if args.command == "contextual":
        print(f"Generating contextual descriptions for vehicle {args.vehicle_id}...")
        result = generate_contextual_descriptions(conn, args.vehicle_id)
        print(f"Status: {result['status']}")
        print(f"Sessions processed: {result.get('sessions_processed', 0)}")
        print(f"Descriptions generated: {result.get('descriptions', 0)}")

    elif args.command == "narrative":
        print(f"Generating narrative for session {args.session_id}...")
        result = generate_session_narrative(conn, args.session_id)
        print(f"Status: {result['status']}")
        if result.get("narrative"):
            print(f"\nNarrative:\n{result['narrative']}")
        if result.get("key_observations"):
            print(f"\nKey observations:")
            for obs in result["key_observations"]:
                print(f"  - {obs}")

    elif args.command == "narratives":
        print(f"Generating narratives for vehicle {args.vehicle_id}...")
        result = generate_vehicle_narratives(conn, args.vehicle_id)
        print(f"Generated: {result['narratives_generated']}, Errors: {result['errors']}")
        for r in result.get("results", []):
            if r.get("narrative"):
                print(f"\n  [{r.get('session_id', '?')[:8]}...] {r['narrative'][:120]}...")

    elif args.command == "contextual-all":
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SET statement_timeout = '30s'")
        cur.execute("""
            SELECT DISTINCT vehicle_id
            FROM image_sets
            WHERE is_auto_session = true
            LIMIT %s
        """, (args.limit,))
        vehicles = cur.fetchall()
        cur.close()

        print(f"Generating contextual descriptions for {len(vehicles)} vehicles...")
        total = 0
        for i, v in enumerate(vehicles):
            vid = str(v["vehicle_id"])
            try:
                result = generate_contextual_descriptions(conn, vid)
                n = result.get("descriptions", 0)
                total += n
                if (i + 1) % 20 == 0:
                    print(f"  [{i+1}/{len(vehicles)}] Total descriptions: {total}")
            except Exception as e:
                print(f"  Error for {vid}: {e}")
        print(f"\nBatch complete: {total} descriptions across {len(vehicles)} vehicles")

    elif args.command == "stats":
        stats = get_description_stats(conn)
        print("Description Stats:")
        print(f"  Total descriptions: {stats['total_descriptions']}")
        print(f"    Pass 1 (raw): {stats['pass_1']}")
        print(f"    Pass 2 (contextual): {stats['pass_2']}")
        print(f"    Pass 3 (refined): {stats['pass_3']}")
        print(f"  Images described: {stats['images_described']}")
        print(f"  Vehicles described: {stats['vehicles_described']}")
        print(f"\nNarrative Stats:")
        print(f"  Total narratives: {stats['total_narratives']}")
        print(f"  Sessions narrated: {stats['sessions_narrated']}")
        print(f"  Vehicles narrated: {stats['vehicles_narrated']}")

    conn.close()


if __name__ == "__main__":
    main()
