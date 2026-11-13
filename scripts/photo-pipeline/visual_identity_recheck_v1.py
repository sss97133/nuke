#!/usr/bin/env python3
"""visual_identity_recheck_v1 — re-check filed photos against the vehicle they are filed on.

Pipeline (all local; no paid API keys; the owner's Claude subscription via `claude -p` with the Read tool only):
  1. Universe: capture_ledger_states rows in on_vehicle (and optionally unverified). Excludes is_sensitive, any redaction,
     empty / non-storage image_url (the empty_url no_file class), and a caller-supplied privacy-exclude id list.
  2. CLIP (local_image_analysis_v1 reader, ViT-B/32) embeds every frame; per-vehicle 5th-nearest isolation is recorded
     as context only.
  3. First look: per-vehicle contact sheets (6 reference tiles + up to 20 candidates). References are unreverted
     capture-set-linked exteriors when a vehicle has >= 4, else the most typical CLIP exterior frames of the gallery.
     The model may flag a tile only with a hard visible clue: wrong_vehicle, unrelated, or personal (personal is log-only).
  4. Second look: every wrong_vehicle / unrelated flag is re-asked alone at higher resolution, without the first clue.
  5. Hold candidates = both looks agree (first wrong_vehicle|unrelated AND second not_this_vehicle), still approved,
     still on the same vehicle, not sensitive, not privacy-excluded.
  6. Hold: dry run unless --apply; one vehicle and at most 50 frames per run; --granted-by required; full pre-hold
     vehicle_images rows backed up to disk before the write; the only write is hold_vehicle_images_for_review
     (audited in vehicle_image_gate_changes). Rollback: select revert_vehicle_image_review_hold('<run>', null, true);

Owner labels are never inputs. Precision is measured on a frozen calibration set built before verdicts are read
(capture-set-linked frames as belongs; prior reasoned misattribution pulls and other vehicles' linked frames as not).
This producer never files, never pulls (rejected_misattributed), never deletes, never merges vehicles.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

VERSION = 'visual_identity_recheck_v1'
METHOD = 'visual_identity_gate:' + VERSION
SHEET_PROMPT_ID = 'vir1-sheet-20261112a'
SINGLE_PROMPT_ID = 'vir1-single-20261112a'
CAP = 50
FIRST_HOLD_VERDICTS = ('wrong_vehicle', 'unrelated')
FIRST_VERDICTS = FIRST_HOLD_VERDICTS + ('personal',)
SECOND_VERDICTS = ('not_this_vehicle', 'personal', 'belongs_or_unsure')
SECRET_ENV = ('ANTHROPIC_API_KEY', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'SUPABASE_SECRET_KEY',
              'SUPABASE_SERVICE_ROLE_KEY', 'GITHUB_TOKEN_WORKFLOW', 'OPENAI_API_KEY')

SHEET_PROMPT = """Open the image file {path} with the Read tool. It is a contact sheet from one owner's vehicle photo library. Every candidate tile (red numbers 1-{n}) is currently filed on ONE vehicle record:
  VEHICLE: {desc}
Blue tiles R1-R{nr} above the yellow line are reference photos of that vehicle ({refnote}).

The owner is a technician: the gallery legitimately includes engine bays, interiors, undercarriage, close-ups of parts and rust, removed parts on a bench, tools, shop scenes with this vehicle in it, and paperwork. Those all BELONG unless something in the frame proves otherwise. The same car can change over time (repaint, primer, parts removed, wheels changed).

Flag a candidate ONLY when there is a hard, visible clue that it does not belong to this vehicle:
- wrong_vehicle: the main subject is clearly a different vehicle — different make/model/body style/generation, different body lines or trim, different paint where a repaint is implausible, a different VIN/plate shown, a motorcycle/boat when the record is a car, etc. Name the clue.
- unrelated: no link to this vehicle at all — e.g. a phone/web screenshot of a different car or listing, a catalog page, retail packaging with no vehicle, a scene with no vehicle and no vehicle part (landscape, house, food, pets), a document naming a different vehicle.
- personal: people, faces, kids, home life as the main subject (log only).
If unsure, or the subject is a generic part/shop detail that could plausibly be this vehicle, do NOT flag it.

Answer with ONLY JSON: {{"sheet":"{sheet}","flags":[{{"tile":<int>,"verdict":"wrong_vehicle|unrelated|personal","clue":"<concrete, <=20 words>"}}],"unreadable":false}}
Use "flags":[] when every candidate plausibly belongs."""

SINGLE_PROMPT = """Open the image file {path} with the Read tool. Left: one CANDIDATE photo. Right: REFERENCE photos R1-R6 of a vehicle record ({refnote}).
The candidate is currently filed on: {desc}.
The owner is a technician; engine bays, interiors, undercarriage, parts, rust close-ups, shop scenes and paperwork of this vehicle all belong. The same car can be repainted or partly disassembled over time.

Does the candidate clearly NOT belong to this vehicle record? Answer "not_this_vehicle" only with a hard visible clue (different make/model/body/generation, different body lines or trim, implausible paint difference, different VIN/plate, screenshot/catalog/listing of another car, scene with no vehicle and no vehicle part). Answer "personal" if people/home life is the main subject. Otherwise answer "belongs_or_unsure".

Answer with ONLY JSON: {{"id":"{id}","verdict":"not_this_vehicle|personal|belongs_or_unsure","clue":"<concrete, <=25 words>"}}"""


# ---------------------------------------------------------------- pure helpers (unit-tested)
def vehicle_desc(v: dict) -> str:
    parts = [str(v.get(k)) for k in ('year', 'make', 'model', 'trim') if v.get(k)]
    col = v.get('color') or v.get('color_primary')
    body = v.get('body_style')
    return ' '.join(parts) + (f', color {col}' if col else '') + (f', body {body}' if body else '')


def last_json(text: str) -> dict:
    """Last top-level JSON object in the model output (prose or earlier objects before it are ignored)."""
    dec, text, i, last = json.JSONDecoder(), text or '', 0, None
    while True:
        j = text.find('{', i)
        if j < 0:
            break
        try:
            obj, end = dec.raw_decode(text, j)
        except ValueError:
            i = j + 1
            continue
        if isinstance(obj, dict):
            last = obj
        i = end
    if last is None:
        raise ValueError('no json in model output')
    return last


def parse_sheet(text: str, n: int) -> list[dict]:
    d = last_json(text)
    flags = d.get('flags')
    if not isinstance(flags, list):
        raise ValueError('flags must be a list')
    out, seen = [], set()
    for f in flags:
        t = int(f['tile'])
        if not 1 <= t <= n:
            raise ValueError(f'tile {t} out of range 1..{n}')
        if f.get('verdict') not in FIRST_VERDICTS or not str(f.get('clue') or '').strip():
            raise ValueError('bad verdict or empty clue')
        if t in seen:
            continue
        seen.add(t)
        out.append({'tile': t, 'verdict': f['verdict'], 'clue': str(f['clue']).strip()})
    return out


def parse_single(text: str, image_id: str) -> dict:
    d = last_json(text)
    if d.get('verdict') not in SECOND_VERDICTS or not str(d.get('clue') or '').strip():
        raise ValueError('bad verdict or empty clue')
    if d.get('id') and d['id'] != image_id:
        raise ValueError('id mismatch')
    return {'verdict': d['verdict'], 'clue': str(d['clue']).strip()}


def eligible_row(row: dict, privacy_exclude: set[str]) -> bool:
    url = row.get('image_url') or ''
    return (bool(url) and 'supabase.co/storage/' in url and not row.get('is_sensitive')
            and row.get('redaction_level') in (None, 'none') and row['id'] not in privacy_exclude)


def hold_candidates(firsts: list[dict], seconds: dict[str, dict], privacy_exclude: set[str]) -> list[dict]:
    """firsts: [{image_id, vehicle_id, state, verdict, clue, sheet, ref_ids, ref_basis}]; seconds: image_id -> {verdict, clue}.
    Both looks must agree; personal is never held here; only frames that were on_vehicle at snapshot time."""
    out, seen = [], set()
    for f in firsts:
        i = f['image_id']
        if i in seen or i in privacy_exclude or f.get('state') != 'on_vehicle' or f['verdict'] not in FIRST_HOLD_VERDICTS:
            continue
        s = seconds.get(i)
        if not s or s['verdict'] != 'not_this_vehicle':
            continue
        seen.add(i)
        out.append({**f, 'second': s})
    return out


def plan_hold_batch(cands: list[dict], vehicle_id: str, current: dict[str, dict], cap: int = CAP) -> list[dict]:
    """Re-check live rows right before a write: same vehicle, still approved, not sensitive. Cap <= 50."""
    cap = min(int(cap), CAP)
    out = []
    for c in cands:
        if c['vehicle_id'] != vehicle_id:
            continue
        r = current.get(c['image_id'])
        if not r or r.get('vehicle_id') != vehicle_id or r.get('vision_gate_status') != 'approved' or r.get('is_sensitive'):
            continue
        out.append(c)
        if len(out) >= cap:
            break
    return out


def run_name(vehicle_id: str, day: str, tag: str) -> str:
    return f'{VERSION}-{vehicle_id[:8]}-{day}{tag}'


def hold_items(batch: list[dict], granted_by: str) -> list[dict]:
    if not (granted_by or '').strip():
        raise ValueError('granted_by is required')
    return [{'image_id': c['image_id'], 'signals': {
        'producer': VERSION, 'granted_by': granted_by.strip(),
        'visual_gate': 'wrong_vehicle' if c['verdict'] == 'wrong_vehicle' else 'unrelated',
        'first_clue': c['clue'], 'second_clue': c['second']['clue'], 'sheet': c.get('sheet'),
        'ref_ids': c.get('ref_ids'), 'ref_basis': c.get('ref_basis'),
        'prompt_ids': [SHEET_PROMPT_ID, SINGLE_PROMPT_ID], 'clip_isolation': c.get('clip_isolation'),
        'confidence': 'high'}} for c in batch]


def wilson_low(k: int, n: int, z: float = 1.96) -> float:
    if n == 0:
        return 0.0
    p = k / n
    den = 1 + z * z / n
    centre = p + z * z / (2 * n)
    adj = z * ((p * (1 - p) + z * z / (4 * n)) / n) ** 0.5
    return (centre - adj) / den


# ---------------------------------------------------------------- I/O
class Db:
    def __init__(self):
        self.url = os.environ.get('SUPABASE_URL', 'https://qkgaybvrernstplzjaam.supabase.co').rstrip('/')
        k = os.environ['SUPABASE_SECRET_KEY']
        self.h = {'apikey': k, 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json'}

    def req(self, m, p, b=None, timeout=180):
        r = urllib.request.Request(self.url + p, data=None if b is None else json.dumps(b).encode(), headers=self.h, method=m)
        with urllib.request.urlopen(r, timeout=timeout) as x:
            t = x.read()
            return json.loads(t) if t else None

    def rows(self, ids, cols='*'):
        out = []
        for i in range(0, len(ids), 150):
            out += self.req('GET', f"/rest/v1/vehicle_images?id=in.({','.join(ids[i:i+150])})&select={cols}")
        return out


def claude(prompt: str, cwd: Path, timeout=300):
    env = {k: v for k, v in os.environ.items() if k not in SECRET_ENV}
    tok = Path.home() / '.claude_oauth_token'
    if tok.exists():
        env['CLAUDE_CODE_OAUTH_TOKEN'] = tok.read_text().strip()
    p = subprocess.run(['claude', '-p', '--output-format', 'text', '--allowedTools', 'Read'], input=prompt,
                       capture_output=True, text=True, env=env, timeout=timeout, cwd=str(cwd))
    return p.stdout or ''


def cmd_hold(a):
    work = Path(a.work_dir)
    privacy = set(Path(a.privacy_exclude).read_text().split()) if a.privacy_exclude else set()
    cands = [c for c in json.loads((work / 'hold_candidates.json').read_text()) if c['image_id'] not in privacy]
    db = Db()
    ids = [c['image_id'] for c in cands if c['vehicle_id'] == a.vehicle]
    if not ids:
        print(json.dumps({'vehicle': a.vehicle, 'items': 0}))
        return
    cur = {r['id']: r for r in db.rows(ids)}
    batch = plan_hold_batch(cands, a.vehicle, cur, a.cap)
    if not batch:
        print(json.dumps({'vehicle': a.vehicle, 'items': 0, 'note': 'nothing still approved on this vehicle'}))
        return
    items = hold_items(batch, a.granted_by)
    run = run_name(a.vehicle, dt.datetime.now().strftime('%Y%m%d'), a.tag)
    reason = (f'{VERSION}: two independent local Claude looks ({SHEET_PROMPT_ID} sheet + {SINGLE_PROMPT_ID} single) each named '
              'a hard visible clue that the frame is not this vehicle; reversible review hold, not a verdict')
    if a.apply:
        bdir = work / 'backups'
        bdir.mkdir(exist_ok=True)
        bf = bdir / f'{run}.json'
        bf.write_text(json.dumps({'run': run, 'at': dt.datetime.now().isoformat(), 'rows': [cur[c['image_id']] for c in batch]}))
        if bf.stat().st_size < 100:
            raise SystemExit('backup failed; nothing written')
    t0 = time.time()
    r = db.req('POST', '/rest/v1/rpc/hold_vehicle_images_for_review', {
        'p_vehicle_id': a.vehicle, 'p_items': items, 'p_method': METHOD, 'p_reason': reason[:500], 'p_run': run, 'p_apply': a.apply})
    line = {'at': dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S %Z'), 'run': run, 'vehicle': a.vehicle, 'apply': a.apply,
            'n': len(batch), 'granted_by': a.granted_by, 'secs': round(time.time() - t0, 1),
            'result': {k: r.get(k) for k in ('held', 'would_hold', 'eligible_public', 'skipped_not_public_other_vehicle_or_unknown')},
            'rollback': f"select revert_vehicle_image_review_hold('{run}', null, true);"}
    if a.apply:
        after = db.rows([c['image_id'] for c in batch], 'vision_gate_status')
        line['verified_review_needed'] = sum(1 for x in after if x['vision_gate_status'] == 'review_needed')
        with open(work / 'holds.log', 'a') as f:
            f.write(json.dumps(line) + '\n')
    print(json.dumps(line))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    h = sub.add_parser('hold', help='emit one capped, signed, revertible hold run for one vehicle')
    h.add_argument('--work-dir', required=True)
    h.add_argument('--vehicle', required=True)
    h.add_argument('--granted-by', required=True)
    h.add_argument('--privacy-exclude')
    h.add_argument('--cap', type=int, default=CAP)
    h.add_argument('--tag', default='a')
    h.add_argument('--apply', action='store_true', help='write; default is a dry run')
    a = ap.parse_args(argv)
    if a.cmd == 'hold':
        if not a.granted_by.strip():
            ap.error('--granted-by is required')
        cmd_hold(a)


if __name__ == '__main__':
    main()
