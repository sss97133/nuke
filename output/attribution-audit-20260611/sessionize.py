#!/usr/bin/env python3
"""Organize the full Photos library into capture sessions.

A session = consecutive photos by the same camera where the gap to the next
photo is < GAP_MIN minutes and GPS (when present on both) moved < RADIUS_KM.
The session is the unit of attribution: one anchored frame binds the session.
"""
import json, re, sys, math
from collections import Counter
from datetime import datetime

GAP_MIN = 45            # minutes between consecutive frames to stay in-session
RADIUS_KM = 1.0         # max drift within a session when both frames have GPS

photos = json.load(open('/tmp/k5-audit/library-all.json'))

def parse(p):
    d = p.get('date')
    if not d: return None
    try: return datetime.fromisoformat(d)
    except ValueError: return None

def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2-la1)/2)**2 + math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2
    return 6371 * 2 * math.asin(math.sqrt(h))

rows = []
for p in photos:
    dt = parse(p)
    if not dt: continue
    rows.append({
        'dt': dt, 'uuid': p.get('uuid'), 'name': p.get('original_filename') or '',
        'lat': p.get('latitude'), 'lon': p.get('longitude'),
        'albums': [a for a in (p.get('albums') or [])],
        'screenshot': bool(p.get('screenshot')),
        'shared': bool(p.get('shared')),
    })
rows.sort(key=lambda r: r['dt'])

sessions, cur = [], []
for r in rows:
    if cur:
        gap = (r['dt'] - cur[-1]['dt']).total_seconds() / 60
        moved = None
        if r['lat'] is not None and cur[-1]['lat'] is not None:
            moved = km((r['lat'], r['lon']), (cur[-1]['lat'], cur[-1]['lon']))
        if gap > GAP_MIN or (moved is not None and moved > RADIUS_KM):
            sessions.append(cur); cur = []
    cur.append(r)
if cur: sessions.append(cur)

# session stats
sizes = Counter()
gps_sessions = 0
album_sessions = 0
YEAR = re.compile(r'(19[2-9]\d|20[0-2]\d)')
for s in sessions:
    n = len(s)
    sizes['1'] += (n == 1)
    sizes['2-9'] += (2 <= n <= 9)
    sizes['10-49'] += (10 <= n <= 49)
    sizes['50+'] += (n >= 50)
    if any(r['lat'] is not None for r in s): gps_sessions += 1
    if any(YEAR.search(a) for r in s for a in r['albums']): album_sessions += 1

# top GPS clusters across sessions (centroid rounded ~300m)
loc = Counter()
for s in sessions:
    pts = [(r['lat'], r['lon']) for r in s if r['lat'] is not None]
    if pts:
        la = sum(p[0] for p in pts)/len(pts); lo = sum(p[1] for p in pts)/len(pts)
        loc[(round(la, 3), round(lo, 3))] += 1

out = []
for s in sessions:
    pts = [(r['lat'], r['lon']) for r in s if r['lat'] is not None]
    albs = Counter(a for r in s for a in r['albums'] if YEAR.search(a))
    out.append({
        'start': s[0]['dt'].isoformat()[:16], 'end': s[-1]['dt'].isoformat()[:16],
        'n': len(s),
        'lat': round(sum(p[0] for p in pts)/len(pts), 5) if pts else None,
        'lon': round(sum(p[1] for p in pts)/len(pts), 5) if pts else None,
        'album_votes': dict(albs.most_common(3)),
        'uuids': [r['uuid'] for r in s],
        'names': [r['name'] for r in s][:200],
    })
json.dump(out, open('/tmp/k5-audit/sessions.json', 'w'))

print(f"photos with dates: {len(rows)} of {len(photos)}")
print(f"sessions: {len(sessions)}  (size 1: {sizes['1']}, 2-9: {sizes['2-9']}, 10-49: {sizes['10-49']}, 50+: {sizes['50+']})")
print(f"sessions with GPS: {gps_sessions}  with vehicle-album frame: {album_sessions}")
print(f"date span: {rows[0]['dt'].date()} -> {rows[-1]['dt'].date()}")
print("\ntop 12 locations by session count:")
for (la, lo), n in loc.most_common(12):
    print(f"  {la},{lo}  {n} sessions")
