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

Local metadata-only mode (no remote census, import of osxphotos or write):
  python3 scripts/assays/iphoto-census.py --metadata-database /private/Photos.sqlite \
      --snapshot-output /private/new-snapshot.json \
      --discovery-config /private/existing-native-input.json --discovery-output /private/new-native-input.json
The optional discovery config supplies only targetVehicleId, timezone and explicit
seedAssetIds. Its old assets are not reused. Feed the new native input through the
existing compiled discover-library-candidates selector, then pass its exact input
and output to native_disposition_adapter.py with --source-snapshot new-snapshot.json.
Do not mistake this local database boundary for full iCloud or PhotoKit permission coverage.
"""
import argparse, collections, datetime as dt, hashlib, json, math, os, sqlite3, stat, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path
from contextlib import closing


def metadata_snapshot(database, max_assets=100000):
    """Private local metadata only: no osxphotos, pixels, cloud request or capture matching.

    The local database is a source boundary, not proof of iCloud completeness or
    the native app's PhotoKit permission scope. Hidden/deleted IDs never leave it.
    """
    if type(max_assets) is not int or not 1 <= max_assets <= 250000:
        raise ValueError('max_assets must be between 1 and 250000')
    started = time.monotonic()
    observed = dt.datetime.now(dt.timezone.utc).isoformat()
    db = sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True, timeout=5)
    db.execute('PRAGMA query_only=ON')
    db.set_progress_handler(lambda: int(time.monotonic() - started > 30), 10000)
    def clock(value):
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            return None
        try:
            return (dt.datetime(2001, 1, 1, tzinfo=dt.timezone.utc) + dt.timedelta(seconds=value)).isoformat()
        except (ValueError, OverflowError):
            return None
    try:
        db.execute('BEGIN')
        columns = {r[1] for r in db.execute('PRAGMA table_info(ZASSET)')}
        required = {'ZUUID', 'ZKIND', 'ZHIDDEN', 'ZTRASHEDSTATE', 'ZDATECREATED', 'ZMODIFICATIONDATE', 'ZLATITUDE', 'ZLONGITUDE'}
        if not required <= columns:
            raise ValueError('unsupported Photos metadata schema: missing ' + ','.join(sorted(required - columns)))
        metadata = db.execute('SELECT Z_UUID FROM Z_METADATA').fetchall()
        if len(metadata) != 1 or not isinstance(metadata[0][0], str) or not metadata[0][0]:
            raise ValueError('unambiguous local Photos store namespace required')
        controls = db.execute('SELECT ZHIDDEN,ZTRASHEDSTATE,count(*) FROM ZASSET GROUP BY ZHIDDEN,ZTRASHEDSTATE').fetchall()
        declared = sum(n for hidden, trashed, n in controls if hidden == 0 and trashed == 0)
        if declared > max_assets:
            raise ValueError(f'visible source count {declared} exceeds explicit bound {max_assets}')
        assets, ids, kinds = [], set(), collections.Counter()
        rows = db.execute('''SELECT ZUUID,ZKIND,ZDATECREATED,ZMODIFICATIONDATE,ZLATITUDE,ZLONGITUDE
                             FROM ZASSET WHERE ZHIDDEN=0 AND ZTRASHEDSTATE=0 ORDER BY ZUUID''')
        for sid, kind, captured, modified, lat, lon in rows:
            if not isinstance(sid, str) or not sid or sid in ids:
                raise ValueError('missing or duplicate source UUID')
            if kind not in (0, 1):
                raise ValueError(f'unsupported visible media kind {kind}; do not silently omit it')
            ids.add(sid); kinds[kind] += 1
            valid_gps = (type(lat) in (float, int) and type(lon) in (float, int)
                         and math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 < lon <= 180)
            version = ('photos_sqlite_modification_seconds:' + repr(modified)) if clock(modified) is not None else None
            assets.append({'id': sid, 'sourceVersion': version, 'mediaKind': 'image' if kind == 0 else 'video',
                           'captureAt': clock(captured), 'captureClockBasis': 'local_photos_database_creation_date',
                           'latitude': lat if valid_gps else None, 'longitude': lon if valid_gps else None,
                           'labels': [], 'exactVehicleIds': [], 'filedVehicleId': None, 'isPersonal': False})
        if len(assets) != declared:
            raise ValueError('source enumeration changed within snapshot')
        identity = hashlib.sha256(json.dumps(assets, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
        return {'schemaVersion': 1, 'intendedUse': 'vehicle_gallery', 'snapshot': {
            'snapshotId': 'local-photos:' + identity, 'sourceNamespace': 'photos_sqlite_store:' + metadata[0][0],
            'sourceScope': 'local_photos_database', 'sourceVersionBasis': 'local_modification_hint',
            'observedAt': observed, 'accessScope': 'sample', 'declaredAssetCount': declared,
            'mediaCoverage': {'imagesEnumerated': True, 'videosEnumerated': True, 'knownVideosOutsideSelector': kinds[1]},
            'enumeration': {'completeWithinLocalDatabase': True, 'photoKitPermission': 'not_measured',
                            'iCloudCompleteness': 'not_measured', 'privacyClassification': 'not_supplied',
                            'excludedRows': sum(n for hidden, trashed, n in controls if hidden != 0 or trashed != 0)},
            'assets': assets}, 'sourceFacts': {}, 'candidates': [], 'priorSourceIds': []}
    finally:
        db.close()


def discovery_input(snapshot, config):
    """Use the existing native selector; no new relevance vocabulary or filing rule."""
    for key in ('targetVehicleId', 'timeZoneIdentifier'):
        if not isinstance(config.get(key), str) or not config[key]:
            raise ValueError('discovery config requires ' + key)
    assets = [a for a in snapshot['snapshot']['assets'] if a['mediaKind'] == 'image']
    seeds = config.get('seedAssetIds', [])
    if not isinstance(seeds, list) or any(not isinstance(x, str) for x in seeds) or len(set(seeds)) != len(seeds):
        raise ValueError('discovery seeds must be unique source IDs')
    if not set(seeds) <= {a['id'] for a in assets}:
        raise ValueError('discovery seed missing from visible image snapshot')
    return {'assets': assets, 'targetVehicleId': config['targetVehicleId'],
            'timeZoneIdentifier': config['timeZoneIdentifier'], 'seedAssetIds': seeds}


def write_private_json(path, value):
    # O_EXCL preserves prior checkpoints and frozen source receipts.
    with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as out:
        json.dump(value, out, sort_keys=True, separators=(',', ':'), allow_nan=False)
        out.write('\n')


def local_original_facts(database, snapshot, source_ids, originals_root):
    """Hash at most 25 explicitly selected local originals; never download iCloud.

    A missing local path says nothing about cloud availability. The version hint,
    current visibility and file identity are rechecked around each byte read.
    """
    if (not isinstance(source_ids, list) or not 1 <= len(source_ids) <= 25
            or any(not isinstance(s, str) for s in source_ids) or len(set(source_ids)) != len(source_ids)):
        raise ValueError('select 1 to 25 unique source IDs')
    meta = snapshot['snapshot']
    if meta.get('sourceScope') != 'local_photos_database' or meta.get('sourceVersionBasis') != 'local_modification_hint':
        raise ValueError('original facts require the exact local metadata snapshot')
    assets = {a['id']: a for a in meta['assets']}
    if not set(source_ids) <= set(assets):
        raise ValueError('selected original outside visible snapshot')
    root = Path(originals_root).resolve(strict=True)
    if not root.is_dir():
        raise ValueError('originals root must be a directory')
    db_uri = Path(database).resolve().as_uri() + '?mode=ro'
    started, total, facts = time.monotonic(), 0, {}
    def within():
        if time.monotonic() - started > 30:
            raise ValueError('local original verification deadline')
    def current(sid):
        # A fresh read transaction observes a modification/withdrawal that
        # committed during the file read; do not reuse the inventory transaction.
        with closing(sqlite3.connect(db_uri, uri=True, timeout=5)) as db:
            db.execute('PRAGMA query_only=ON')
            db.set_progress_handler(lambda: int(time.monotonic() - started > 30), 10000)
            db.execute('BEGIN')
            namespace = db.execute('SELECT Z_UUID FROM Z_METADATA').fetchall()
            if len(namespace) != 1 or 'photos_sqlite_store:' + namespace[0][0] != meta['sourceNamespace']:
                raise ValueError('local source namespace changed')
            rows = db.execute('''SELECT ZKIND,ZDIRECTORY,ZFILENAME,ZMODIFICATIONDATE,ZDATECREATED
                FROM ZASSET WHERE ZUUID=? AND ZHIDDEN=0 AND ZTRASHEDSTATE=0''', (sid,)).fetchall()
            if len(rows) != 1:
                raise ValueError('selected source withdrawn or ambiguous')
            return rows[0]
    def mime(header):
        if header.startswith(b'\xff\xd8\xff'): return 'image/jpeg'
        if header.startswith(b'\x89PNG\r\n\x1a\n'): return 'image/png'
        if header.startswith((b'II*\x00', b'MM\x00*')): return 'image/tiff'
        if header[:4] == b'RIFF' and header[8:12] == b'WEBP': return 'image/webp'
        if header[4:8] == b'ftyp':
            if header[8:12] in (b'heic', b'heix', b'hevc', b'hevx'): return 'image/heic'
            if header[8:12] in (b'mif1', b'msf1'): return 'image/heif'
            if header[8:12] in (b'avif', b'avis'): return 'image/avif'
        raise ValueError('unsupported original byte format')
    for sid in source_ids:
        within()
        asset, before = assets[sid], current(sid)
        kind, directory, filename, modified, captured = before
        version = 'photos_sqlite_modification_seconds:' + repr(modified)
        if kind != 0 or asset.get('mediaKind') != 'image' or asset.get('sourceVersion') != version:
            raise ValueError('selected original source version changed or unsupported')
        # Photos' original path is explicit metadata, not a filename search.
        if (not isinstance(directory, str) or not isinstance(filename, str)
                or Path(directory).name != directory or Path(filename).name != filename
                or directory in ('', '.', '..') or filename in ('', '.', '..')):
            raise ValueError('invalid original source path')
        path = root / directory / filename
        if not path.resolve().is_relative_to(root) or path.is_symlink():
            raise ValueError('original source path escapes or redirects')
        fact = {'sourceVersion': version, 'selectedForAdmission': False,
                'localOriginalReadAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                'originalStatus': 'unverified'}
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            fact['localOriginalStatus'] = 'not_present'
        else:
            with os.fdopen(fd, 'rb') as source:
                initial = os.fstat(source.fileno())
                if not stat.S_ISREG(initial.st_mode) or not 0 < initial.st_size <= 64 * 1024 * 1024:
                    raise ValueError('original file outside regular-file byte bound')
                if total + initial.st_size > 128 * 1024 * 1024:
                    raise ValueError('original total byte bound exceeded')
                checksum, header, size = hashlib.sha256(), b'', 0
                while True:
                    within()
                    chunk = source.read(1024 * 1024)
                    if not chunk: break
                    if not header: header = chunk[:32]
                    checksum.update(chunk); size += len(chunk)
                    if size > initial.st_size: raise ValueError('original grew during read')
                final = os.fstat(source.fileno())
            signature = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
            if size != initial.st_size or signature(initial) != signature(final) or signature(final) != signature(path.stat()):
                raise ValueError('original changed during read')
            total += size
            fact['original'] = {'sourceVersion': version, 'sha256': checksum.hexdigest(), 'byteSize': size, 'mimeType': mime(header),
                'readBasis': {'kind': 'local_photos_original_path', 'sourceNamespace': meta['sourceNamespace'],
                              'relativePath': str(path.relative_to(root)), 'observedAt': fact['localOriginalReadAt']}}
            fact['localOriginalStatus'] = 'verified'
            fact['originalStatus'] = 'verified'
        if current(sid) != before:
            raise ValueError('local source changed during original read')
        prior = snapshot.get('sourceFacts', {}).get(sid, {}).get('original')
        if (prior and fact.get('original') and prior.get('sourceVersion') == version
                and prior.get('sha256') != fact['original']['sha256']):
            raise ValueError('original bytes changed under the same source version')
        facts[sid] = fact
    within()
    return facts

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
    ap = argparse.ArgumentParser(); ap.add_argument("--user-id"); ap.add_argument("--write", action="store_true")
    ap.add_argument('--metadata-database', type=Path)
    ap.add_argument('--snapshot-output', type=Path)
    ap.add_argument('--snapshot-input', type=Path, help='reuse a frozen local snapshot for bounded original checks')
    ap.add_argument('--max-assets', type=int, default=100000)
    ap.add_argument('--discovery-config', type=Path)
    ap.add_argument('--discovery-output', type=Path)
    ap.add_argument('--verify-local-originals', type=Path, help='JSON list of at most 25 explicitly selected source IDs')
    ap.add_argument('--originals-root', type=Path, help='explicit local Photos originals directory; no download')
    a = ap.parse_args()
    if a.metadata_database or a.snapshot_output or a.snapshot_input or a.discovery_config or a.discovery_output or a.verify_local_originals or a.originals_root:
        if not a.metadata_database or not a.snapshot_output or a.write or bool(a.discovery_config) != bool(a.discovery_output):
            ap.error('metadata mode requires database and new snapshot output, optional paired discovery config/output, and refuses --write')
        if bool(a.verify_local_originals) != bool(a.originals_root):
            ap.error('local original verification requires both selected IDs and originals root')
        if a.snapshot_input and not a.verify_local_originals:
            ap.error('snapshot reuse requires bounded original verification')
        for output in (a.snapshot_output, a.discovery_output):
            if output and output.exists():
                ap.error('output already exists: ' + str(output))
        snapshot = json.loads(a.snapshot_input.read_text()) if a.snapshot_input else metadata_snapshot(a.metadata_database, a.max_assets)
        if a.verify_local_originals:
            snapshot.setdefault('sourceFacts', {}).update(local_original_facts(a.metadata_database, snapshot,
                json.loads(a.verify_local_originals.read_text()), a.originals_root))
        discovery = discovery_input(snapshot, json.loads(a.discovery_config.read_text())) if a.discovery_config else None
        write_private_json(a.snapshot_output, snapshot)
        if discovery is not None:
            write_private_json(a.discovery_output, discovery)
        print(json.dumps({'mode': 'read_only_local_metadata', 'assets': snapshot['snapshot']['declaredAssetCount'],
                          'sourceScope': 'local_photos_database', 'sourceProposals': 0}))
        raise SystemExit(0)
    if not a.user_id:
        ap.error('--user-id is required for the existing remote census mode')
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
