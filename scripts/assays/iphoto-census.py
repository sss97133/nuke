#!/usr/bin/env python3
"""iphoto-census: how much of the owner's Photos library (source `iphoto`) have we captured?

A monitor, not a one-off count. Each run records one `source_census` row for source `iphoto`
through `record_census` (read it back with `get_latest_census('iphoto')`):
  universe_total  = visible photos in the library (not hidden, not in Recently Deleted)
  universe_active = visible photos that carry a vehicle-like Apple label (an UPPER BOUND, see below)
  by_year         = visible photos per capture year
  raw_response    = definitions, denominators and the capture match. Counts only: no filenames or pixels.

Reads Photos.sqlite metadata through osxphotos (signed python.org 3.13, see the photo-sync TCC note).
No image bytes are read or sent. The capture match is filename stem + capture second against
vehicle_images rows of the owner (interim: the phone has stable PhotoKit identifiers and should
become the census taker).

Run (dry run prints, --write records):
  cd ~/nuke && dotenvx run -- /Library/Frameworks/Python.framework/Versions/3.13/bin/python3 \
      scripts/assays/iphoto-census.py --user-id <owner uuid> [--write]
"""
import argparse, collections, datetime as dt, json, os, urllib.error, urllib.parse, urllib.request

# Apple on-device scene labels that suggest a vehicle. Broad on purpose ("machine", "wheel"), so the
# count is an upper bound, not a measure of automotive relevance.
VEHICLE_LABELS = {"car", "vehicle", "automobile", "truck", "pickup truck", "suv", "van", "motor vehicle",
                  "wheel", "tire", "engine", "jeep", "sedan", "coupe", "convertible", "motorcycle", "bus",
                  "taxi", "race car", "sports car", "classic car", "windshield", "steering wheel",
                  "license plate", "dashboard", "car seat", "car interior", "machine"}

def library_census():
    import osxphotos
    out = {"photos": 0, "videos": 0, "hidden": 0, "trashed": 0, "geotagged": 0, "vehicle_label": 0,
           "icloud_only": 0}
    by_year, keys = collections.Counter(), []
    for p in osxphotos.PhotosDB().photos(movies=True):
        if p.intrash: out["trashed"] += 1; continue
        if p.hidden: out["hidden"] += 1; continue
        if p.ismovie: out["videos"] += 1; continue
        out["photos"] += 1
        if p.latitude is not None: out["geotagged"] += 1
        if not p.path: out["icloud_only"] += 1
        labels = {l.lower() for l in (p.labels or [])}
        car = bool(labels & VEHICLE_LABELS)
        if car: out["vehicle_label"] += 1
        if p.date: by_year[str(p.date.year)] += 1
        keys.append((os.path.splitext(p.original_filename or "")[0].lower(), epoch(p.date), car))
    return out, dict(by_year), keys

def epoch(d):
    if d is None: return None
    if d.tzinfo is None: d = d.replace(tzinfo=dt.timezone.utc)
    return int(d.timestamp())

def rest(path, body=None, method="GET"):
    base, key = os.environ["VITE_SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    req = urllib.request.Request(f"{base}/rest/v1/{path}", method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=60))

def owner_rows(user_id):
    """Owner's vehicle_images (file_name, taken_at, vehicle_id) in monthly windows; a window that
    times out is split in half. Returns (rows, failed_windows)."""
    rows, failed = [], []
    def window(a, b):
        q = (f"vehicle_images?select=file_name,taken_at,vehicle_id&user_id=eq.{user_id}"
             f"&taken_at=gte.{urllib.parse.quote(a.isoformat())}&taken_at=lt.{urllib.parse.quote(b.isoformat())}&limit=1000")
        off = 0
        try:
            while True:
                page = rest(q + f"&offset={off}")
                rows.extend(page)
                if len(page) < 1000: return
                off += 1000
        except urllib.error.HTTPError as e:
            if e.code not in (500, 502, 503, 504, 408, 429):  # a rejected query is a bug, not a timeout
                raise RuntimeError(f"vehicle_images query rejected ({e.code}): {e.read()[:200]!r}")
            if (b - a).days <= 1: failed.append(a.isoformat()); return
            mid = a + (b - a) / 2
            window(a, mid); window(mid, b)
    y0, y1 = 2003, dt.date.today().year
    now = dt.datetime.now(dt.timezone.utc)
    for y in range(y0, y1 + 1):
        for m in range(1, 13):
            a = dt.datetime(y, m, 1, tzinfo=dt.timezone.utc)
            if a > now: break
            b = dt.datetime(y + (m == 12), m % 12 + 1, 1, tzinfo=dt.timezone.utc)
            window(a, b)
    rows += [r for r in rest(f"vehicle_images?select=file_name,taken_at,vehicle_id&user_id=eq.{user_id}&taken_at=is.null&limit=1000")]
    return rows, failed

def match(keys, rows):
    byname, bytime = collections.defaultdict(list), collections.defaultdict(list)
    for r in rows:
        e = epoch(dt.datetime.fromisoformat(r["taken_at"].replace("Z", "+00:00"))) if r.get("taken_at") else None
        byname[(os.path.splitext(r["file_name"] or "")[0].lower(), e)].append(r)
        if e: bytime[e].append(r)
    cap = cap_veh = cap_car = 0
    for stem, e, car in keys:
        hit = byname.get((stem, e)) or (bytime.get(e, []) if e else [])
        if hit:
            cap += 1; cap_car += car; cap_veh += any(h["vehicle_id"] for h in hit)
    return {"captured": cap, "captured_on_a_vehicle": cap_veh, "captured_vehicle_label": cap_car}

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--user-id", required=True); ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    c, by_year, keys = library_census()
    rows, failed = owner_rows(a.user_id)
    m = match(keys, rows)
    raw = {"definitions": {
              "universe_total": "visible photos: not hidden, not in Recently Deleted; videos counted separately",
              "universe_active": "visible photos with an Apple on-device label from a broad vehicle-like set: an UPPER BOUND on automotive relevance",
              "captured": "library photo whose filename stem + capture second (or capture second alone) matches a vehicle_images row of the owner; approximate"},
           "library": c, "match": m, "owner_rows_read": len(rows), "failed_windows": failed,
           "coverage": {"captured_of_universe": round(m["captured"] / max(c["photos"], 1), 4),
                        "captured_vehicle_label_of_vehicle_label": round(m["captured_vehicle_label"] / max(c["vehicle_label"], 1), 4)},
           "check": "compare universe_total with the count shown in the Photos app header"}
    print(json.dumps(raw, indent=1))
    if a.write:
        cid = rest("rpc/record_census", {"p_source_slug": "iphoto", "p_universe_total": c["photos"],
                  "p_universe_active": c["vehicle_label"], "p_census_method": "photos_db_read",
                  "p_census_confidence": 0.95, "p_by_year": by_year, "p_raw_response": raw}, "POST")
        print("recorded census", cid)
