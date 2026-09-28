#!/usr/bin/env python3
"""Land the K5 engine-harness facts in Nuke as vehicle_observations, through ingest-observation.

One observation per write-up field (plug, wire, wire end, tool, check), shaped like the May 2026 wire-property rows
(source k5_wire_closure_receipts: structured_data {wire_id, property_key, value, citation}), plus:
  check      what audit_citations.py found: VERIFIED / PARTIAL / NOT_FOUND / ... and which values it found where
  rules      the plug-end design rules for that wire end (check_plug_ends.py)
  proof      for a part: proof it is lined up (a captured cart line), bought (a receipt), installed (on the truck).
             No proof, no claim (owner, 2026-09-26: "you either have proof a part was lined up, bought, installed or you dont").

The observation's source is the evidence that actually backs it, not the one it names:
  VERIFIED        -> the rung of the ladder that verified it (motec-documentation, component-maker-documentation,
                     parts-vendor-listing, dave-m130-sheet, community-wiring-reference)
  anything else   -> k5-wiring-unchecked-citation (cites something our code couldn't confirm)
  our own records -> k5-wiring-design (cavity map, names, bench/open items)
Confidence is computed by ingest-observation from the source, never entered here.

Usage: dotenvx run -- python3 load_observations.py [--only EID] [--dry-run] [--limit N]
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

CD = Path(__file__).resolve().parent
REPO = CD.parents[2]
sys.path.insert(0, str(CD))
import audit_citations as A        # noqa: E402
import check_plug_ends as P        # noqa: E402
import kits_v5 as K                # noqa: E402

K5 = "e08bf694-970f-4cbe-8a74-8715158a0f2e"
EXCEPT = set(sys.argv[sys.argv.index("--except") + 1].split(",")) if "--except" in sys.argv else set()
SNAP = REPO / "reference_documents/web_snapshots"
LADDER = {
    "motec": "motec-documentation", "dmc": "component-maker-documentation", "siemensdeka": "component-maker-documentation",
    "holley": "component-maker-documentation", "checkline": "component-maker-documentation", "amphenol": "component-maker-documentation",
    "prowire": "parts-vendor-listing", "digikey": "parts-vendor-listing", "seal_": "parts-vendor-listing", "cck_": "parts-vendor-listing",
    "wire_od": "parts-vendor-listing", "ict_": "parts-vendor-listing", "edmo": "parts-vendor-listing",
    "dave": "dave-m130-sheet", "maxxecu": "community-wiring-reference", "rusefi": "community-wiring-reference",
    "ls1tech": "community-wiring-reference",
}


def ladder_source(sid):
    for k, v in LADDER.items():
        if sid.startswith(k):
            return v
    return "k5-wiring-unchecked-citation"


def snapshot_url(stem):
    f = SNAP / f"{stem}.md"
    if f.exists():
        m = re.search(r"source: (\S+)", f.read_text(errors="ignore")[:400])
        return m.group(1) if m else None
    return None


def excerpt_for(src_entry, field_row, tokens):
    """(url, page, excerpt) from the first stored source that holds one of the field's values."""
    for p in A.split_sources(field_row.get("source")):
        sid, kind, where = A.classify(p)
        if sid != src_entry["id"]:
            continue
        txt, note = A.source_text(sid, kind, where, p)
        if not txt:
            continue
        for kind_tok, t in tokens:
            if A.found((kind_tok, t), txt):
                T = re.sub(r"[\s ]+", " ", txt)
                i = T.upper().find(t.upper()) if kind_tok not in ("pin",) else -1
                if i < 0:
                    m = re.search(rf"\b{t[0]}0?{int(t[1:])}\b" if kind_tok == "pin" else re.escape(t), T, re.I)
                    i = m.start() if m else 0
                ex = T[max(0, i - 70): i + 90].strip()
                page = None
                if kind == "stored_pdf":
                    slug, _ = where
                    for pg, ptxt in (A._cache.get(slug) or {}).items():
                        if A.found((kind_tok, t), ptxt):
                            page = pg
                            break
                stems = where if isinstance(where, list) else [where] if kind == "snapshot" else []
                url = next((snapshot_url(s) for s in stems if snapshot_url(s)), None)
                return url, page, ex
    return None, None, None


def cart_proof(reg):
    """part code -> proof it is lined up: the captured cart line (vendor, cart id, capture time, file)."""
    proof = {}
    for f in sorted((CD / "orders").glob("*.json")):
        d = json.load(open(f))
        for line in d.get("lines") or []:
            code = str(line.get("code") or line.get("sku") or line.get("item") or "")
            if code:
                proof[code] = {"doc": f"docs/wiring/calc-data/orders/{f.name}", "vendor": d.get("vendor"),
                               "cart": d.get("account_cart"), "captured": d.get("captured"),
                               "method": d.get("method") or "cart read-back", "qty": line.get("qty")}
    return proof


def build(only=None):
    reg = json.load(open(CD / "k5_registry.json"))
    audit = {(x["endpoint"], x["field"]): x for x in A.audit()}
    rules = {}
    for x in P.run():
        rules.setdefault((x["endpoint"], str(x["wire"])), x["rules"])
    carts = cart_proof(reg)
    sha = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    # observed_at = when this registry version was committed, so a re-run of the same data hashes the same
    # (ingest-observation dedupes on content_hash, which includes observed_at) and never double-inserts
    now = subprocess.run(["git", "-C", str(REPO), "log", "-1", "--format=%cI", "--", "docs/wiring/calc-data/k5_registry.json"],
                         capture_output=True, text=True).stdout.strip() or datetime.now(timezone.utc).isoformat(timespec="seconds")
    out = []
    for eid, d in reg["dossiers"].items():
        if only and eid != only:
            continue
        if eid in EXCEPT:
            continue
        name = K.BOOK_TITLE.get(eid, eid)
        repeats = {f for f, n in __import__("collections").Counter(r["field"] for r in d["rows"]).items() if n > 1}
        for rw in d["rows"]:
            field, value, state = rw["field"], str(rw["value"]), rw["state"]
            m = re.match(r"^#(\S+)\s+(.*)$", field)
            wire, prop = (m.group(1), m.group(2)) if m else (None, field)
            chk = audit.get((eid, field)) if state == "cited" else None
            sd = {"domain": "wiring", "harness": "engine", "registry": f"k5_registry v5 @ {sha}", "plug": eid, "plug_name": name,
                  "row_field": field, "wire_id": wire, "property_key": prop, "value": value, "state": state,
                  "citation": rw.get("source")}
            src, url, page, ex, rank = "k5-wiring-design", None, None, None, "normal"
            if chk:
                sd["check"] = {"status": chk["status"], "found": [s for s in chk["sources"] if s.get("found")],
                               "missing": chk["missing"], "checker": f"audit_citations.py @ {sha}"}
                if chk["status"] == "VERIFIED":
                    ver = next(s for s in chk["sources"] if s.get("found"))
                    src = ladder_source(ver["id"])
                    toks = {(t.split(":", 1)[0], t.split(":", 1)[1]) for t in chk["tokens"]}
                    url, page, ex = excerpt_for(ver, rw, sorted(toks))
                    rank = "preferred" if src in ("motec-documentation", "component-maker-documentation") else "normal"
                elif chk["status"] != "SELF_ONLY":
                    src = "k5-wiring-unchecked-citation"
            if wire and prop in ("device end", "ECU end", "firewall"):
                ep = {"device end": eid, "ECU end": "M130-" + (value.split(":")[1][0] if value.startswith("M130:") else "?"),
                      "firewall": "FIREWALL-ENGINE"}[prop]
                r = rules.get((ep, wire))
                if r:
                    sd["rules"] = {k: {"status": v[0], "why": v[1]} for k, v in r.items()}
            if prop in ("plug / kit",):
                code = value.split(" ")[0]
                sd["proof"] = {"lined_up": carts.get(code), "bought": None, "installed": None,
                               "rule": "no proof, no claim (owner 2026-09-26)"}
            out.append({
                "source_slug": src, "kind": "specification", "observed_at": now, "vehicle_id": K5,
                "source_identifier": f"k5-wiring:{eid}:{field}" + (
                    ":" + re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:48] if field in repeats else ""),
                "source_url": url,
                "content_text": f"{name} · {field}: {value}" + (f" [{state}]" if state != "cited" else ""),
                "structured_data": sd,
                "citation": {k: v for k, v in (("page_number", page), ("excerpt", ex)) if v},
                "extraction_method": "registry_v5_loader", "agent_tier": "agent", "agent_model": "claude-opus-5-5",
                "raw_source_ref": f"docs/wiring/calc-data/k5_registry.json@{sha}", "rank": rank,
            })
    return out


def post(payload, url, key):
    """One observation. 4xx = our payload is wrong (no retry); timeouts/5xx = the server is struggling (back off)."""
    import urllib.error
    body = json.dumps(payload).encode()
    for wait in (0, 10, 30, 60):
        if wait:
            time.sleep(wait)
        req = urllib.request.Request(f"{url}/functions/v1/ingest-observation", data=body, method="POST",
                                     headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            detail = e.read()[:400].decode(errors="ignore")
            if e.code < 500:
                return {"error": f"HTTP {e.code}", "detail": detail}
            last = {"error": f"HTTP {e.code}", "detail": detail}
        except Exception as e:
            last = {"error": str(e)}
    return last


def main():
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    rows = build(only)
    if limit:
        rows = rows[:limit]
    from collections import Counter
    print(f"{len(rows)} observations · by source: {dict(Counter(r['source_slug'] for r in rows))}")
    print(f"  by state: {dict(Counter(r['structured_data']['state'] for r in rows))}")
    if "--dry-run" in sys.argv:
        for r in rows[:3]:
            print(json.dumps(r, indent=1)[:1500])
        return
    url, key = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key):
        sys.exit("SUPABASE URL / SERVICE_ROLE key not set (run under dotenvx from the repo root)")
    # skip facts already landed (a timed-out request may have inserted before the server dropped the connection)
    q = urllib.request.Request(f"{url}/rest/v1/vehicle_observations?select=source_identifier&vehicle_id=eq.{K5}"
                               f"&source_identifier=like.k5-wiring:*&is_superseded=is.false&limit=10000",
                               headers={"Authorization": f"Bearer {key}", "apikey": key})
    with urllib.request.urlopen(q, timeout=90) as r:
        have = {x["source_identifier"] for x in json.loads(r.read())}
    rows = [r for r in rows if r["source_identifier"] not in have]
    print(f"already in the database: {len(have)} · to send: {len(rows)} (insert-only)")
    log = CD / ".load_observations.log.jsonl"
    ok = dup = bad = 0
    with open(log, "a") as fh:
        for r in rows:
            try:
                res = post(r, url, key)
            except Exception as e:
                res = {"error": str(e)}
            fh.write(json.dumps({"source_identifier": r["source_identifier"], "result": res}) + "\n")
            if res.get("duplicate"):
                dup += 1
            elif res.get("success"):
                ok += 1
            else:
                bad += 1
                print("FAIL", r["source_identifier"], res)
                if bad >= 3:
                    sys.exit("stopping after 3 failures")
            time.sleep(0.15)
    print(f"inserted {ok} · duplicates {dup} · failed {bad} · log {log.name}")


if __name__ == "__main__":
    main()
