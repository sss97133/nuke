#!/usr/bin/env python3
"""Build the markdown surfaces from session_topic data.

Outputs:
  /Users/skylar/nuke/output/session_classifier/PROGRESS.md       — pipeline status
  /Users/skylar/nuke/output/session_classifier/by_topic/{topic}.md — per-bucket list
  /Users/skylar/nuke/output/session_classifier/k5_blazer_1977.md  — priority vehicle surface
  /Users/skylar/nuke/output/session_classifier/UNCLASSIFIED.md   — confidence < 0.6
"""
import json
import os
import subprocess
import sys
from collections import defaultdict

OUT_DIR = "/Users/skylar/nuke/output/session_classifier"
BY_TOPIC_DIR = f"{OUT_DIR}/by_topic"

VEHICLES = {
    "e08bf694-970f-4cbe-8a74-8715158a0f2e": ("k5_blazer_1977", "1977 K5 Blazer", "CKR187F127263"),
    "83f6f033-a3c3-4cf4-a85e-a60d2c588838": ("mustang_1966",   "1966 Ford Mustang", "6F07C219593"),
    "d7adb919-93d8-4fc3-af1b-afb4e027acb3": ("k20_doug_1974",  "1974 K20 Cheyenne (Doug)", "CKY244Z103570"),
    "21ee373f-765e-4e24-a69d-e59e2af4f467": ("hot_rod_1932",   "1932 Ford Hot Rod (sold)", "AZ370615"),
    "a90c008a-3379-41d8-9eb2-b4eda365d74c": ("k2500_1983",     "1983 GMC K2500 (Granholm)", "1GTGK24M1DJ514592"),
    "1db5daca-526e-42c6-99ae-7faee79b5bad": ("suburban_1995",  "1995 Suburban 2500 (sold)", "1GNGK26N7SJ349264"),
    "d47d1c55-5d0a-4a04-96af-8b335f4fdc30": ("k10_1984",       "1984 K10", None),
}


def fetch_all_rows():
    """Pull rows as a single json array result. Bypass COPY entirely."""
    sql_path = "/tmp/_fetch_rows.sql"
    out_path = "/tmp/_session_topic_dump.json"
    # Single-row result: one big JSON aggregate. Use psql variable -c with -t -A to strip headers/format.
    sql = (
        "SELECT json_agg(t)::text FROM ("
        "SELECT session_id, project_dir, jsonl_path, "
        "COALESCE(first_prompt,'') AS first_prompt, "
        "COALESCE(modified_at::text,'') AS modified_at, "
        "COALESCE(turn_count,0) AS turn_count, "
        "primary_topic, "
        "COALESCE(secondary_topics,'{}') AS secondary_topics, "
        "COALESCE(vehicle_ids::text[],'{}') AS vehicle_ids, "
        "classification_confidence, "
        "classification_method "
        "FROM public.session_topic "
        "WHERE session_id ~ '^[a-f0-9-]{36}$' "
        "ORDER BY modified_at DESC NULLS LAST"
        ") t \\g " + out_path
    )
    with open(sql_path, "w") as f:
        f.write(sql)
    cmd = ["dotenvx", "run", "--quiet", "--", "bash", "-c",
           f'PGPASSWORD="$SUPABASE_DB_PASSWORD" psql -h "db.qkgaybvrernstplzjaam.supabase.co" -U postgres -p 5432 -d postgres -t -A -f {sql_path}']
    result = subprocess.run(cmd, capture_output=True, text=True, cwd="/Users/skylar/nuke")
    if result.returncode != 0:
        print("psql stderr:", result.stderr, file=sys.stderr)
        raise RuntimeError("psql failed")
    raw = open(out_path).read().strip()
    # Could be wrapped with a header row '?column?' if -t didn't take; strip until first '['
    idx = raw.find("[")
    if idx > 0:
        raw = raw[idx:]
    # Strip trailing parentheses/row counts if psql -t didn't suppress
    # Actually psql -t with -A and \g writes just the data, but be defensive
    return json.loads(raw)


def write_topic_file(topic, rows):
    safe = topic.replace(":", "__").replace("/", "_")
    path = f"{BY_TOPIC_DIR}/{safe}.md"
    with open(path, "w") as f:
        f.write(f"# {topic}\n\n")
        f.write(f"**{len(rows)} sessions** classified to this primary topic.\n\n")
        f.write("Sorted newest first. `conf` = classification confidence (0-1). "
                "`turns` = total user+assistant turns in session.\n\n")
        f.write("| date | conf | turns | secondary | first prompt | jsonl |\n")
        f.write("|---|---|---|---|---|---|\n")
        for r in rows:
            date = (r["modified_at"] or "")[:10]
            fp = (r["first_prompt"] or "").replace("|", "\\|").replace("\n", " ")[:140]
            sec = ",".join(r["secondary_topics"])[:60]
            jsonl_short = os.path.basename(r["jsonl_path"]) if r["jsonl_path"] else ""
            f.write(f"| {date} | {r['classification_confidence']} | {r['turns'] if False else r['turn_count']} | {sec} | {fp} | `{jsonl_short}` |\n")
    return path


def write_k5_priority_surface(rows):
    """The K5 active-build surface — extract richer context."""
    k5_id = "e08bf694-970f-4cbe-8a74-8715158a0f2e"
    k5_rows = [r for r in rows if k5_id in r["vehicle_ids"]]
    # Sort: primary K5 sessions first, then secondary mentions
    k5_rows.sort(key=lambda r: (r["primary_topic"] != "vehicle:k5_blazer_1977",
                                r["modified_at"] or ""), reverse=False)
    primary = [r for r in k5_rows if r["primary_topic"] == "vehicle:k5_blazer_1977"]
    secondary = [r for r in k5_rows if r["primary_topic"] != "vehicle:k5_blazer_1977"]
    primary.sort(key=lambda r: r["modified_at"] or "", reverse=True)
    secondary.sort(key=lambda r: r["modified_at"] or "", reverse=True)

    path = f"{OUT_DIR}/k5_blazer_1977.md"
    with open(path, "w") as f:
        f.write("# 1977 K5 Blazer — Session Feed\n\n")
        f.write("Vehicle ID: `e08bf694-970f-4cbe-8a74-8715158a0f2e`  \n")
        f.write("VIN: `CKR187F127263`  \n")
        f.write("Active build — LS3 swap, MoTeC, ongoing wiring harness fabrication.  \n\n")
        f.write(f"**{len(primary)} primary K5 sessions + {len(secondary)} secondary mentions = {len(k5_rows)} total sessions touching this vehicle.**\n\n")
        f.write("Query:\n")
        f.write("```sql\n")
        f.write("SELECT * FROM session_topic\n")
        f.write("WHERE 'e08bf694-970f-4cbe-8a74-8715158a0f2e' = ANY(vehicle_ids)\n")
        f.write("ORDER BY modified_at DESC;\n")
        f.write("```\n\n")
        f.write("---\n\n")

        f.write("## Primary K5 sessions (chronological, newest first)\n\n")
        f.write("Sessions where the K5 was the dominant topic. These contain build decisions, "
                "reviewer feedback (PDM manuals, harness layouts, ProWire orders), and "
                "wiring approach iterations.\n\n")
        for r in primary:
            date = (r["modified_at"] or "")[:10]
            jsonl = r["jsonl_path"]
            fp = (r["first_prompt"] or "").replace("\n", " ")[:300]
            f.write(f"### {date} — conf {r['classification_confidence']} — `{r['session_id'][:8]}`\n")
            f.write(f"- turns: {r['turn_count']}\n")
            if r["secondary_topics"]:
                f.write(f"- secondary: {', '.join(r['secondary_topics'])}\n")
            f.write(f"- jsonl: `{jsonl}`\n")
            f.write(f"- opening prompt: {fp}\n\n")

        f.write("---\n\n")
        f.write("## Secondary K5 mentions (K5 came up but was not the primary topic)\n\n")
        f.write("| date | primary topic | conf | session | first prompt |\n")
        f.write("|---|---|---|---|---|\n")
        for r in secondary:
            date = (r["modified_at"] or "")[:10]
            fp = (r["first_prompt"] or "").replace("|", "\\|").replace("\n", " ")[:120]
            f.write(f"| {date} | {r['primary_topic']} | {r['classification_confidence']} | `{r['session_id'][:8]}` | {fp} |\n")

    return path


def write_progress(rows, by_topic):
    path = f"{OUT_DIR}/PROGRESS.md"
    by_method = defaultdict(int)
    by_conf = {"0.8+": 0, "0.6-0.8": 0, "0.4-0.6": 0, "<0.4": 0}
    for r in rows:
        by_method[r["classification_method"]] += 1
        c = float(r["classification_confidence"])
        if c >= 0.8: by_conf["0.8+"] += 1
        elif c >= 0.6: by_conf["0.6-0.8"] += 1
        elif c >= 0.4: by_conf["0.4-0.6"] += 1
        else: by_conf["<0.4"] += 1

    with open(path, "w") as f:
        f.write("# Session Classifier — Progress\n\n")
        f.write(f"**Total sessions classified: {len(rows)}**\n\n")
        f.write("## Source breakdown\n\n")
        f.write("- 63 sessions have top-level JSONLs in `~/.claude/projects/-Users-skylar/` "
                "(full transcript available, first-prompt + early turns + deep keyword scan)\n")
        f.write("- ~382 sessions have only subagent transcripts (main session JSONL was cleaned); "
                "topic detected from subagent content fallback\n")
        f.write("- ~22 sessions seeded from `sessions-index.json` for the older `-Users-skylar-nuke` dir\n\n")
        f.write("## Topic counts (primary)\n\n")
        f.write("| topic | sessions |\n|---|---|\n")
        for t, count in sorted(by_topic.items(), key=lambda x: -len(x[1])):
            f.write(f"| `{t}` | {len(count)} |\n")

        f.write("\n## Classification method\n\n")
        f.write("| method | sessions |\n|---|---|\n")
        for m, c in sorted(by_method.items(), key=lambda x: -x[1]):
            f.write(f"| `{m}` | {c} |\n")

        f.write("\n## Confidence distribution\n\n")
        f.write("| band | sessions |\n|---|---|\n")
        for b, c in by_conf.items():
            f.write(f"| {b} | {c} |\n")

        f.write("\n## Vehicle attribution (across primary + secondary)\n\n")
        f.write("Sessions that touched each vehicle (vehicle_id appears in `vehicle_ids` array):\n\n")
        f.write("| vehicle | sessions touching |\n|---|---|\n")
        for vid, (slug, name, vin) in VEHICLES.items():
            count = sum(1 for r in rows if vid in r["vehicle_ids"])
            f.write(f"| {name} (`{vid[:8]}`) | {count} |\n")

        f.write("\n## Output files\n\n")
        f.write("- `PROGRESS.md` — this file\n")
        f.write("- `k5_blazer_1977.md` — priority surface for active K5 build\n")
        f.write("- `by_topic/*.md` — per-bucket session lists\n")
        f.write("- `UNCLASSIFIED.md` — sessions with confidence < 0.6, need manual review\n")
        f.write("- `classifications.json` — raw classifier output\n")
        f.write("- `ISSUES.md` — file-level read errors\n\n")
        f.write("## Substrate location\n\n")
        f.write("Per-session rows live in `public.session_topic` in the Nuke DB. "
                "Query for a vehicle's session feed:\n\n")
        f.write("```sql\n")
        f.write("SELECT session_id, modified_at, primary_topic, first_prompt\n")
        f.write("FROM public.session_topic\n")
        f.write("WHERE '<vehicle_id>' = ANY(vehicle_ids)\n")
        f.write("ORDER BY modified_at DESC;\n")
        f.write("```\n")
    return path


def write_unclassified(rows):
    low = [r for r in rows if float(r["classification_confidence"]) < 0.6]
    low.sort(key=lambda r: r["modified_at"] or "", reverse=True)
    path = f"{OUT_DIR}/UNCLASSIFIED.md"
    with open(path, "w") as f:
        f.write("# Sessions Needing Manual Review (confidence < 0.6)\n\n")
        f.write(f"**{len(low)} sessions** could not be confidently classified by keyword. "
                "Reasons typically: very short session, no recognized topic keywords, "
                "or no source text available (main JSONL cleaned + subagent traces sparse).\n\n")
        f.write("| date | conf | primary | first prompt | session |\n")
        f.write("|---|---|---|---|---|\n")
        for r in low:
            date = (r["modified_at"] or "")[:10]
            fp = (r["first_prompt"] or "").replace("|", "\\|").replace("\n", " ")[:150]
            f.write(f"| {date} | {r['classification_confidence']} | {r['primary_topic']} | {fp} | `{r['session_id'][:8]}` |\n")
    return path


def main():
    os.makedirs(BY_TOPIC_DIR, exist_ok=True)
    rows = fetch_all_rows()
    print(f"Fetched {len(rows)} rows from session_topic", file=sys.stderr)

    by_topic = defaultdict(list)
    for r in rows:
        by_topic[r["primary_topic"]].append(r)

    for topic, topic_rows in by_topic.items():
        # Sort newest first
        topic_rows.sort(key=lambda r: r["modified_at"] or "", reverse=True)
        path = write_topic_file(topic, topic_rows)
        print(f"  wrote {path} ({len(topic_rows)} sessions)", file=sys.stderr)

    k5_path = write_k5_priority_surface(rows)
    print(f"  wrote {k5_path}", file=sys.stderr)

    unclass_path = write_unclassified(rows)
    print(f"  wrote {unclass_path}", file=sys.stderr)

    progress = write_progress(rows, by_topic)
    print(f"  wrote {progress}", file=sys.stderr)


if __name__ == "__main__":
    main()
