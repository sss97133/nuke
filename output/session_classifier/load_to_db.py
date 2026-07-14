#!/usr/bin/env python3
"""Load classifications.json into public.session_topic via direct psql COPY-style INSERT.

Idempotent: ON CONFLICT (session_id) DO UPDATE so reruns refresh classifications.
"""
import json
import os
import subprocess
import sys

CLASSIFICATIONS = "/Users/skylar/nuke/output/session_classifier/classifications.json"


def pg_array_text(items):
    """Format Python list of strings as Postgres array literal."""
    if not items:
        return "{}"
    escaped = []
    for x in items:
        s = str(x).replace("\\", "\\\\").replace('"', '\\"')
        escaped.append(f'"{s}"')
    return "{" + ",".join(escaped) + "}"


def pg_array_uuid(uuids):
    if not uuids:
        return "{}"
    return "{" + ",".join(uuids) + "}"


def main():
    data = json.load(open(CLASSIFICATIONS))
    print(f"Loading {len(data)} rows...", file=sys.stderr)

    rows = []
    for r in data:
        rows.append({
            "session_id": r["session_id"],
            "project_dir": r["project_dir"],
            "jsonl_path": r["jsonl_path"],
            "first_prompt": (r.get("first_prompt") or "")[:5000],
            "modified_at": r.get("modified_at"),
            "turn_count": r.get("turn_count") or 0,
            "primary_topic": r["primary_topic"],
            "secondary_topics": r.get("secondary_topics") or [],
            "vehicle_ids": r.get("vehicle_ids") or [],
            "person_ids": [],
            "organization_ids": [],
            "classification_confidence": r["classification_confidence"],
            "classification_method": r["classification_method"],
        })

    # Use COPY via psql for speed and to avoid SQL escaping pain
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".tsv", delete=False) as tf:
        for r in rows:
            cols = [
                r["session_id"],
                r["project_dir"],
                r["jsonl_path"],
                (r["first_prompt"] or "").replace("\t", " ").replace("\n", " ").replace("\r", " "),
                r["modified_at"] or "\\N",
                str(r["turn_count"]),
                r["primary_topic"],
                pg_array_text(r["secondary_topics"]),
                pg_array_uuid(r["vehicle_ids"]),
                pg_array_uuid(r["person_ids"]),
                pg_array_uuid(r["organization_ids"]),
                str(r["classification_confidence"]),
                r["classification_method"],
            ]
            tf.write("\t".join(cols) + "\n")
        tsv_path = tf.name

    print(f"TSV: {tsv_path}", file=sys.stderr)

    # Stage into temp table, then upsert
    sql = f"""
\\set ON_ERROR_STOP on
BEGIN;

DROP TABLE IF EXISTS _session_topic_staging;
CREATE TEMP TABLE _session_topic_staging (LIKE public.session_topic INCLUDING DEFAULTS);
ALTER TABLE _session_topic_staging DROP COLUMN IF EXISTS classified_at;

\\COPY _session_topic_staging (session_id, project_dir, jsonl_path, first_prompt, modified_at, turn_count, primary_topic, secondary_topics, vehicle_ids, person_ids, organization_ids, classification_confidence, classification_method) FROM '{tsv_path}' WITH (FORMAT csv, DELIMITER E'\\t', NULL '\\N', QUOTE E'\\b');

-- Dedupe by session_id: keep the row with the highest confidence
-- (a session can appear in multiple project_dirs if subagents leaked).
INSERT INTO public.session_topic AS t (
    session_id, project_dir, jsonl_path, first_prompt, modified_at, turn_count,
    primary_topic, secondary_topics, vehicle_ids, person_ids, organization_ids,
    classification_confidence, classification_method
)
SELECT DISTINCT ON (session_id)
       session_id, project_dir, jsonl_path, first_prompt, modified_at, turn_count,
       primary_topic, secondary_topics, vehicle_ids, person_ids, organization_ids,
       classification_confidence, classification_method
FROM _session_topic_staging
ORDER BY session_id, classification_confidence DESC NULLS LAST, turn_count DESC
ON CONFLICT (session_id) DO UPDATE SET
    project_dir = EXCLUDED.project_dir,
    jsonl_path = EXCLUDED.jsonl_path,
    first_prompt = EXCLUDED.first_prompt,
    modified_at = EXCLUDED.modified_at,
    turn_count = EXCLUDED.turn_count,
    primary_topic = EXCLUDED.primary_topic,
    secondary_topics = EXCLUDED.secondary_topics,
    vehicle_ids = EXCLUDED.vehicle_ids,
    person_ids = EXCLUDED.person_ids,
    organization_ids = EXCLUDED.organization_ids,
    classification_confidence = EXCLUDED.classification_confidence,
    classification_method = EXCLUDED.classification_method,
    classified_at = now();

COMMIT;

SELECT primary_topic, COUNT(*) FROM public.session_topic GROUP BY 1 ORDER BY 2 DESC;
"""
    sql_path = "/tmp/load_session_topic.sql"
    open(sql_path, "w").write(sql)

    cmd = [
        "dotenvx", "run", "--",
        "bash", "-c",
        f'PGPASSWORD="$SUPABASE_DB_PASSWORD" psql -h "db.qkgaybvrernstplzjaam.supabase.co" -U postgres -p 5432 -d postgres -f {sql_path}'
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd="/Users/skylar/nuke")
    print("STDOUT:", result.stdout)
    print("STDERR:", result.stderr, file=sys.stderr)
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
