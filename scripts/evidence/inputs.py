"""Input readers shared by the passes. Paths come from the case's `inputs` (a local file, never in the repo).

Image rows and listing rows are q.sh read logs ({"sql", "result": [...]}) or plain JSON lists. Photos inputs are
metadata CSVs (photos_index.py, photos_join.py). Money and document sources go through the pinned list
(common.PinnedSources) and nothing here returns an amount except the load-time resolvers in amounts.py.
"""
import collections
import csv
import math

import common
import photos_join


def _rows(path):
    d = common.load_json(path)
    return d['result'] if isinstance(d, dict) and 'result' in d else d


def image_rows(ctx):
    """The owner's image rows in scope: id, source, taken_at, filename, created_at, his, uid_null, sup, dup, gate."""
    return ctx.cached('image_rows', lambda: _rows(ctx.input_path('image_rows')))


def listing_rows(ctx):
    p = ctx.input_path('listing_rows')
    return ctx.cached('listing_rows', lambda: _rows(p) if p else [])


def primary_ids(ctx):
    p = ctx.input_path('primary_rows')
    return ctx.cached('primary', lambda: {r['id'] for r in _rows(p)} if p else set())


def work_sessions(ctx):
    p = ctx.input_path('work_sessions')
    return ctx.cached('sessions', lambda: _rows(p) if p else [])


def session_by_day(ctx):
    return {s['session_date']: s['id'] for s in work_sessions(ctx)}


def photos_index(ctx):
    paths = (ctx.case.get('inputs') or {}).get('photos_index') or []
    if isinstance(paths, str):
        paths = [paths]
    return ctx.cached('photos_index', lambda: photos_join.load_index([ctx.path(p) for p in paths]))


def photos_join_records(ctx):
    """{image_id: join record} for the image rows: the precomputed join CSV when the case names one, else the join
    computed from the Photos index."""
    def load():
        ids = {r['id'] for r in image_rows(ctx)}
        p = ctx.input_path('photos_join')
        if p:
            return photos_join.read_join_csv(p, ids)
        by_uuid, by_stem = photos_index(ctx)
        return {r['image_id']: r for r in photos_join.join_rows(image_rows(ctx), by_uuid, by_stem)}
    return ctx.cached('photos_join', load)


def album_items(ctx):
    p = ctx.input_path('album_items')
    if not p:
        return []
    def load():
        with open(p, newline='', encoding='utf-8') as f:
            return list(csv.DictReader(f))
    return ctx.cached('album_items', load)


def dist_m(a, b, c, d):
    return 6371000 * math.hypot(math.radians(c - a), math.radians(d - b) * math.cos(math.radians(a)))


def place_cluster(ctx, lat, lon):
    """A place label from case.place_clusters [{label, lat, lon, radius_m}] (coordinates stay in the local case;
    outputs carry labels only)."""
    if lat in ('', None) or lon in ('', None):
        return 'no_gps'
    la, lo = float(lat), float(lon)
    for c in ctx.case.get('place_clusters') or []:
        if dist_m(la, lo, c['lat'], c['lon']) < c['radius_m']:
            return c['label']
    return ctx.case.get('place_cluster_default', 'en_route')


def albums_of(rec):
    titles = [t for t in (rec.get('albums') or '').split(';') if t]
    uuids = [u for u in (rec.get('album_uuids') or '').split(';') if u]
    return titles, uuids


def day_counts(records, field='photos_date_local'):
    c = collections.Counter()
    for r in records:
        if r.get(field):
            c[r[field][:10]] += 1
    return c
