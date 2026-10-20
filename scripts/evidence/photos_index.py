"""Build the Photos.app metadata index the time and album passes read (port of the join-index index.py).

Read-only, metadata only: uuid, original file name, stem, capture instants and time zone, location, album
memberships, camera. No pixels are read and nothing leaves the Mac. Needs osxphotos (not a repo dependency: install it
in the Python that runs this, e.g. `pip install osxphotos`); the passes themselves only read the CSV this writes.

Album titles that name a person or an address are replaced by the local redaction list (a JSON object
{"<album uuid prefix>": "<replacement title>"}, kept under nuke-logs, never in the repo).

Usage: python3 scripts/evidence/photos_index.py --out <dir> [--redactions <json>] [--since 2023-06-01]
"""
import argparse
import csv
import datetime as dt
import json
import os
import sys

COLS = ['photos_uuid', 'original_filename', 'stem', 'date_local', 'date_utc', 'tz_offset_seconds', 'latitude',
        'longitude', 'is_movie', 'is_missing_original', 'camera_make', 'camera_model', 'fingerprint', 'albums',
        'album_uuids', 'is_hidden']


def album_title(a, redact):
    for prefix, title in redact.items():
        if a.uuid.upper().startswith(prefix.upper()):
            return title
    return a.title or ''


def row(p, redact):
    fn = p.original_filename or p.filename or ''
    d = p.date
    lat, lon = (p.location or (None, None))
    ex = p.exif_info
    albs = sorted(p.album_info, key=lambda a: (a.title or '', a.uuid))
    return {
        'photos_uuid': p.uuid, 'original_filename': fn, 'stem': os.path.splitext(fn)[0].upper(),
        'date_local': d.isoformat() if d else '', 'date_utc': d.astimezone(dt.timezone.utc).isoformat() if d else '',
        'tz_offset_seconds': p.tzoffset if p.tzoffset is not None else (int(d.utcoffset().total_seconds()) if d else ''),
        'latitude': '' if lat is None else lat, 'longitude': '' if lon is None else lon,
        'is_movie': int(bool(p.ismovie)), 'is_missing_original': int(bool(p.ismissing)),
        'camera_make': (ex.camera_make or '') if ex else '', 'camera_model': (ex.camera_model or '') if ex else '',
        'fingerprint': p.fingerprint or '', 'albums': ';'.join(album_title(a, redact) for a in albs),
        'album_uuids': ';'.join(a.uuid for a in albs), 'is_hidden': int(bool(p.hidden)),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out', required=True)
    ap.add_argument('--redactions')
    ap.add_argument('--since', default='2023-06-01', help='local date; older items go to PHOTOS-INDEX-OLDER.csv')
    a = ap.parse_args()
    try:
        import osxphotos  # noqa: PLC0415  (optional, local only)
    except ImportError:
        sys.exit('photos_index needs osxphotos in this Python (pip install osxphotos); the passes read its CSV')
    redact = {}
    if a.redactions:
        with open(a.redactions) as f:
            redact = json.load(f)
    cut = dt.datetime.fromisoformat(a.since)
    db = osxphotos.PhotosDB()
    os.makedirs(a.out, exist_ok=True)
    n = {'new': 0, 'old': 0}
    with open(os.path.join(a.out, 'PHOTOS-INDEX.csv'), 'w', newline='') as fn, \
            open(os.path.join(a.out, 'PHOTOS-INDEX-OLDER.csv'), 'w', newline='') as fo:
        wn, wo = csv.DictWriter(fn, fieldnames=COLS), csv.DictWriter(fo, fieldnames=COLS)
        wn.writeheader()
        wo.writeheader()
        for p in sorted(db.photos(intrash=False),
                        key=lambda p: (p.date or dt.datetime.min.replace(tzinfo=dt.timezone.utc), p.uuid)):
            new = p.date is not None and p.date.replace(tzinfo=None) >= cut
            (wn if new else wo).writerow(row(p, redact))
            n['new' if new else 'old'] += 1
    with open(os.path.join(a.out, 'PHOTOS-ALBUMS.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['album_uuid', 'title', 'folder', 'items_all_dates'])
        for al in sorted(db.album_info, key=lambda al: (al.title or '', al.uuid)):
            w.writerow([al.uuid, album_title(al, redact), '/'.join(al.folder_names), len(al.photos)])
    print(json.dumps(n))


if __name__ == '__main__':
    main()
