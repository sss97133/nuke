#!/usr/bin/env python3
"""
Send Cars & Bids series / trim / body_style proposals to public.record_facet_evidence.

The facet values come from the same rules backfill-cab-taxonomy-and-outcomes.py used (extract_cab_facets), so the
evidence describes how each value was reached. record_facet_evidence decides status: a value readable in the
listing title is accepted, a chassis code derived from year + model is pending. Multi-code BMW series
("E90/E92/E93") are narrowed to one code where the body style names it.

Usage:
  dotenvx run -- python3 scripts/record-cab-facet-evidence.py [--limit N] [--dry-run]
"""
import argparse
import importlib.util
import json
import os
import re
import time

spec = importlib.util.spec_from_file_location(
    "cab_backfill", os.path.join(os.path.dirname(os.path.abspath(__file__)), "backfill-cab-taxonomy-and-outcomes.py")
)
cab_backfill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cab_backfill)

JUNK_SERIES = {"modern"}
BATCH = 200

# Body-code families: live series (without an M suffix) -> {body keyword: code}.
NARROW_BY_BODY = {
    "E90/E92/E93": {"sedan": "E90", "wagon": "E91", "coupe": "E92", "convertible": "E93"},
    "F82/F83": {"coupe": "F82", "convertible": "F83"},
    "G82/G83": {"coupe": "G82", "convertible": "G83"},
    "E85/E86": {"roadster": "E85", "convertible": "E85", "coupe": "E86"},
    "E63/E64": {"coupe": "E63", "convertible": "E64"},
    "F06/F12/F13": {"gran coupe": "F06", "convertible": "F12", "coupe": "F13"},
    "E36/7 / E36/8": {"roadster": "E36/7", "convertible": "E36/7", "coupe": "E36/8"},
}


def words(text):
    return " " + re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip() + " "


def narrowed_code(live_series, body_style, title):
    if not live_series or "/" not in live_series:
        return None
    m = re.match(r"^(.*?)(\s+M\d)?$", live_series)
    base, suffix = m.group(1), (m.group(2) or "")
    table = NARROW_BY_BODY.get(base)
    if not table:
        return None
    haystack = words(title) + words(body_style)
    for keyword in sorted(table, key=len, reverse=True):
        if f" {keyword} " in haystack:
            return table[keyword] + suffix
    return None


def proposals_for(row):
    vid, year, make, model, title, listing_title, series, trim, body = row
    cited = listing_title or title
    sub_title = listing_title.split("—", 1)[1].strip() if listing_title and "—" in listing_title else None
    facets = cab_backfill.extract_cab_facets(
        year=year, make=make, model=model, title=title or listing_title, sub_title=sub_title, existing_body_style=body
    )
    out = []
    s = facets["series"]
    if s and s.lower() not in JUNK_SERIES and re.sub(r"[^a-z0-9]", "", s.lower()) != re.sub(r"[^a-z0-9]", "", (model or "").split(" ")[0].lower()):
        in_title = words(s) in words(cited)
        out.append({
            "vehicle_id": vid, "field": "series", "value": s,
            "source_type": "cars_and_bids_listing" if in_title else "derived_chassis_rule",
            "cited_title": cited,
            "derivation": None if in_title else f"extract_cab_facets chassis rule: {year} {make} {model}",
        })
    code = narrowed_code(series, body, cited)
    if code:
        out.append({
            "vehicle_id": vid, "field": "series", "value": code, "source_type": "derived_chassis_rule",
            "cited_title": cited, "derivation": f"{series} narrowed by body style {body!r}",
            "expected_live": series, "narrow": True,
        })
    t = facets["trim"] or trim
    if t:
        out.append({"vehicle_id": vid, "field": "trim", "value": t, "source_type": "cars_and_bids_listing", "cited_title": cited})
    b = facets["body_style"] or body
    if b:
        out.append({"vehicle_id": vid, "field": "body_style", "value": b, "source_type": "cars_and_bids_listing", "cited_title": cited})
    return [p for p in out if p["value"] and len(p["value"]) <= 60]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    conn = cab_backfill.connect_db()
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SET statement_timeout = '5min';")
    cur.execute(
        """
        SELECT id::text, year, make, model, title, listing_title, series, trim, body_style
        FROM public.vehicles
        WHERE discovery_source = 'carsandbids' AND deleted_at IS NULL AND status IS DISTINCT FROM 'merged'
        ORDER BY id
        """ + (f" LIMIT {int(args.limit)}" if args.limit else "")
    )
    rows = cur.fetchall()
    proposals = [p for r in rows for p in proposals_for(r)]
    by_kind = {}
    for p in proposals:
        key = (p["field"], p["source_type"], bool(p.get("narrow")))
        by_kind[key] = by_kind.get(key, 0) + 1
    print(f"{len(rows)} vehicles -> {len(proposals)} proposals: {by_kind}", flush=True)
    if args.dry_run:
        for p in [p for p in proposals if p.get("narrow")][:10]:
            print("  narrow:", p["expected_live"], "->", p["value"], "|", p["derivation"])
        return

    totals = {"evidence_accepted": 0, "evidence_pending": 0, "filled": 0, "narrowed": 0}
    conn.autocommit = False
    t0 = time.time()
    for i in range(0, len(proposals), BATCH):
        chunk = proposals[i : i + BATCH]
        for attempt in range(5):
            try:
                cur.execute("SET LOCAL statement_timeout = '55s';")
                cur.execute("SELECT public.record_facet_evidence(%s::jsonb)", (json.dumps(chunk),))
                result = cur.fetchone()[0]
                conn.commit()
                break
            except Exception as err:
                conn.rollback()
                print(f"  [retry {attempt + 1}/5] {err}", flush=True)
                time.sleep(2 + 2 * attempt)
        else:
            raise RuntimeError(f"batch at {i} failed after 5 attempts")
        for k in totals:
            totals[k] += int(result.get(k) or 0)
        if (i // BATCH) % 25 == 0:
            print(f"  {min(i + BATCH, len(proposals))}/{len(proposals)} {totals} {time.time() - t0:.0f}s", flush=True)
    print(f"done: {totals} in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
