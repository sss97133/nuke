#!/usr/bin/env python3
"""Land Mecum Road Art lots from a retained index pull as asset entities, through the sanctioned writer.

A one-off landing (fleet rule: a chore run once is a script, not a schedule). Reads the retained Algolia index
documents (one JSON document per line, as pulled on 2026-10-14 into ~/nuke-logs/mecum-index-20261015/index.ndjson),
keeps the lots the house labels lot_type "Road Art", maps each to the record_asset_lots input and posts them 500 at a
time as top-level PostgREST RPC with the service-role key. Also writes one source_census row (census_method
house_department_facet) with the house's own lot_type counts and priced counts, so asset_lot_coverage('mecum') has
its denominator. Nothing is fetched from Mecum; nothing is parsed into maker or model columns (the house's make and
model labels are kept as printed in `lines` and `house_group`).

Lives in scripts/extractors (scripts/data is gitignored). Run from the repo root under dotenvx so the keys never appear on a command line:
    dotenvx run -- python3 scripts/extractors/land_mecum_road_art.py ~/nuke-logs/mecum-index-20261015/index.ndjson --limit 1000
    dotenvx run -- python3 scripts/extractors/land_mecum_road_art.py ~/nuke-logs/mecum-index-20261015/index.ndjson --census
Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

Clocks: the index pull is the read clock (--pulled-at, default 2026-10-15T04:15:00Z, the 2026-10-14 21:15 PT pull); a lot
whose sale has ended by then gets observed_at = the sale's end day (observed_at_basis sale_end), otherwise the pull time
(index_read). Result: the house's own sale_result label when present (sold / bid goes on / ...), else derived from sold,
bid_goes_on and the end clock. Price: highest_bid_or_price as the index states it (price_basis highest_bid_or_price:
Mecum's index does not say hammer vs high bid; buyer's premium is not adjusted).
Type: Road Art is automobilia; a Road Art lot whose model label names a guitar, framed art, poster or photograph is
memorabilia (the house's division stays in house_category).
"""
import argparse, ast, datetime as dt, json, os, re, sys, time, urllib.error, urllib.request

METHOD = "mecum_index_road_art_v1"
MEMORABILIA = ("guitar", "framed art", "poster", "photograph", "lithograph", "print", "painting", "artwork")


def names(tax, key):
    return [x.get("name") for x in (tax or {}).get(key, []) if isinstance(x, dict) and x.get("name")]


def parse_taxonomies(raw):
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw:
        try:
            return ast.literal_eval(raw)
        except (ValueError, SyntaxError):
            try:
                return json.loads(raw)
            except ValueError:
                return {}
    return {}


def iso(ts):
    return dt.datetime.fromtimestamp(int(ts), dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def map_lot(doc, tax, pulled_at):
    web_id = str(doc.get("web_id_meta") or "").strip()
    title = (doc.get("post_title") or "").strip()
    # Older sales key lots with a sale prefix (FL23-538806); newer ones are bare numbers. Both are the house's lot id.
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", web_id) or len(title) < 3:
        return None
    lot_type = names(tax, "lot_type")
    division = names(tax, "division_tax")
    make = names(tax, "make")
    model = names(tax, "model")
    sale_result = [s.lower() for s in names(tax, "sale_result")]
    sale = names(tax, "auction_tax")
    sale_name, sale_key, sale_ends = None, None, None
    if sale:
        parts = sale[0].split("|")
        sale_name = parts[0] or None
        slug = (tax.get("auction_tax") or [{}])[0].get("slug")
        sale_key = f"mecum-{slug}" if slug else None
        if len(parts) >= 3 and parts[2].lstrip("-").isdigit() and int(parts[2]) > 0:
            sale_ends = iso(parts[2])
    end_epoch = doc.get("auction_end_date_meta")
    if isinstance(end_epoch, (int, float)) and end_epoch > 0:
        sale_ends = iso(end_epoch)
    pulled_epoch = int(dt.datetime.fromisoformat(pulled_at.replace("Z", "+00:00")).timestamp())
    ended = isinstance(end_epoch, (int, float)) and 0 < end_epoch < pulled_epoch
    price = doc.get("highest_bid_or_price")
    price = float(price) if isinstance(price, (int, float)) and price > 0 else None
    if sale_result:
        result = sale_result[0].replace(" ", "_")
    elif doc.get("sold") == 1:
        result = "sold"
    elif doc.get("bid_goes_on") == 1:
        result = "bid_goes_on"
    elif ended:
        result = "not_sold"
    else:
        result = "upcoming"
    sold = result == "sold"
    group = model[0] if model else None
    low = (group or "").lower()
    asset_type = "memorabilia" if any(k in low for k in MEMORABILIA) else "automobilia"
    collections = names(tax, "collection_tax")
    return {
        "identity_key": f"mecum:{web_id}",
        "asset_type": asset_type,
        "title": title[:500],
        "source_identifier": web_id,
        "source_url": "https://www.mecum.com" + (doc.get("permalink") or f"/lots/{web_id}/"),
        "observed_at": sale_ends if (ended and sale_ends) else pulled_at,
        "observed_at_basis": "sale_end" if (ended and sale_ends) else "index_read",
        "department_code": lot_type[0] if lot_type else "Road Art",
        "department_name": division[0] if division else (lot_type[0] if lot_type else "Road Art"),
        "house_group": group,
        "lot_number": doc.get("lot_number_meta") or None,
        "sale_key": sale_key,
        "sale_name": sale_name,
        "sale_ends_at": sale_ends,
        "result": result,
        "price_basis": "highest_bid_or_price" if (price and sold) else None,
        "hammer_price": price if sold else None,
        "estimate_low": None,
        "estimate_high": None,
        "currency": "USD",
        "lines": [x for x in [make[0] if make else None, group] if x],
        "symbols": [s for s in names(tax, "lot_status")][:6],
        "footnotes": ("; ".join(c.split("|")[0] for c in collections) or None),
        "country": "United States",
        "extraction_method": METHOD,
        "ts_page": None,
        "ts_pass": 0,
        "high_bid": None if sold else price,
    }


def post(url, key, body, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={
        "Authorization": "Bearer " + key, "apikey": key, "Content-Type": "application/json", "Prefer": "return=representation"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:500]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("index", help="retained index pull, one JSON document per line")
    ap.add_argument("--limit", type=int, default=0, help="land at most this many Road Art lots (0 = all)")
    ap.add_argument("--batch", type=int, default=500)
    ap.add_argument("--pulled-at", default="2026-10-15T04:15:00Z")
    ap.add_argument("--census", action="store_true", help="write the house lot_type census row for mecum")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not a.dry_run and (not base or not key):
        sys.exit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (run under dotenvx)")

    by_type, priced_by_type = {}, {}
    batch, totals, n_road, docs = [], {}, 0, 0
    t0 = time.time()

    def flush():
        nonlocal batch
        if not batch:
            return
        if a.dry_run:
            totals["dry_lots"] = totals.get("dry_lots", 0) + len(batch)
            batch = []
            return
        status, receipt = post(f"{base}/rest/v1/rpc/record_asset_lots", key, {"p_source_slug": "mecum", "p_lots": batch})
        if status != 200 or not isinstance(receipt, dict):
            sys.exit(f"record_asset_lots failed: HTTP {status} {receipt}")
        for k in ("in", "assets_new", "assets_existing", "observations_new", "observations_same", "observations_superseded", "refused"):
            totals[k] = totals.get(k, 0) + int(receipt.get(k) or 0)
        if receipt.get("refused_keys"):
            totals.setdefault("refused_keys", []).extend(receipt["refused_keys"][:5])
        batch = []
        time.sleep(0.2)

    with open(a.index) as fh:
        for line in fh:
            try:
                doc = json.loads(line)
            except ValueError:
                continue
            docs += 1
            tax = parse_taxonomies(doc.get("taxonomies"))
            lt = names(tax, "lot_type")
            code = lt[0] if lt else "(none)"
            by_type[code] = by_type.get(code, 0) + 1
            if doc.get("sold") == 1 and isinstance(doc.get("highest_bid_or_price"), (int, float)) and doc["highest_bid_or_price"] > 0:
                priced_by_type[code] = priced_by_type.get(code, 0) + 1
            if "Road Art" not in lt:
                continue
            if a.limit and n_road >= a.limit:
                continue
            rec = map_lot(doc, tax, a.pulled_at)
            if not rec:
                totals["unmappable"] = totals.get("unmappable", 0) + 1
                continue
            n_road += 1
            batch.append(rec)
            if len(batch) >= a.batch:
                flush()
                print(json.dumps({"landed_so_far": n_road, **{k: v for k, v in totals.items() if k != "refused_keys"}}), flush=True)
    flush()

    census = None
    if a.census and not a.dry_run:
        pulled = a.pulled_at
        # source id: read through PostgREST (service role) by slug
        req = urllib.request.Request(f"{base}/rest/v1/observation_sources?slug=eq.mecum&select=id", headers={"Authorization": "Bearer " + key, "apikey": key})
        with urllib.request.urlopen(req, timeout=30) as r:
            rows = json.loads(r.read())
        if not rows:
            sys.exit("observation_sources.mecum missing")
        row = {
            "source_id": rows[0]["id"], "universe_total": docs, "universe_historical": sum(priced_by_type.values()),
            "census_method": "house_department_facet", "census_confidence": 0.9, "census_at": pulled,
            "census_url": "algolia:wp_posts_lot (retained pull, ~/nuke-logs/mecum-index-20261015/index.ndjson)",
            "census_notes": "Mecum public index, retained pull of 2026-10-14: every lot by the house's lot_type (by_category); raw_response.priced = lots sold with a stated highest_bid_or_price per lot_type; raw_response.names = the same labels. Read for asset lots (Road Art).",
            "by_category": by_type, "raw_response": {"priced": priced_by_type, "names": {k: k for k in by_type}, "slice": ["Road Art"], "pulled_at": pulled},
        }
        status, census = post(f"{base}/rest/v1/source_census", key, row, timeout=60)
        if status not in (200, 201):
            sys.exit(f"census insert failed: HTTP {status} {census}")
    print(json.dumps({"docs": docs, "road_art_seen": by_type.get("Road Art", 0), "road_art_landed": n_road, "by_type": by_type,
                      "priced_by_type": priced_by_type, "elapsed_s": round(time.time() - t0, 1), "census_written": bool(census),
                      **totals}, indent=1, default=str))


if __name__ == "__main__":
    main()
