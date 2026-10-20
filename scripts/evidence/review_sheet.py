"""Review sheet (PLAN pilot step 4, section 5 step 7): one batched owner review, one question per numbered row.

(v5, v6 AC1-AC4, AC9) Each numbered row asks ONE question, in one dimension, and names its targets, which the review
run stores (config.rows.<n>: targets, question, asks) so an answer decides only what its row asked:
  album        "Is the album 'X' the truck A?"               the album link                 yes / no / no, it is <truck>
  identity     "Is A the same truck as B?"                    the pair claim                 yes / no
  photo        "Does this photo show A?"                      the candidate and its image    yes / no / no, it is <truck>
  money        "Was payment P A's?"                           P and P's unallocated links    yes / no / no, it was <truck>
               "Is <source> right that P was not A's?"        the contradicting link and P   yes / no
               "Was money in P for A?"                        P and its links on A           yes / no / no, it was <truck>
  who paid     "Who paid <the line or the purchase>?"         one placement link or claim    <me / business / party>
               (asks: party; it decides nothing, an owner statement answers it; a document line that supports a
               purchase or sale the case already asks "who paid" about is not asked twice)
  dates        "Is the <kind> claim right?"                   the claim                      yes / no
  accounts     "Is account X E's?"                            the map row and the account    yes / no, it is <entity>
The row profile the writer derives (question, asks, asked_place, frame, link_class and the places, images, keys and
accounts it covers; evidence_sheet_row) is computed here too, so record_answers.py can check a reading before it is
stored. A row in several places (asked_place 'multi') or of mixed frames or money classes takes only a bare yes or no.
Questions that decide no evidence row (spend, the writers, the Photos order; "is account X closed, or is an export
missing?" for a lagging money source) are listed apart as lettered decisions, answered in OWNER-DECISIONS.

(v6, AC10) The sheet opens by reading back what the agent recorded from his answers in the last 7 days (the read-back
list loop/readback.jsonl, appended by record_answers.py decide), so an objection reaches the next sheet; a row whose
reading was disputed (loop/disputed.jsonl) is asked again until a delivered sheet has asked it.

Photos: one row per image. A thumbnail only for an image the phone's VisionEngine approved (vision_gate_status
'approved'); any other image is listed by id, "review in the app". Thumbnails are local paths (the case's
review.thumbnails_dir/<image id>.jpg); no URL is embedded. No amounts and no personal contact details.

The sheet is review-<date>.md with a sidecar review-<date>.json (rows with targets and profiles, decisions); its sha256
and row count are over the .md bytes. In db mode the review run (evidence_open_run run_kind 'review', pass
'review_sheet', config {sheet_sha256, items, sheet, rows}) is opened and closed before anything is sent, target ids come
from the loader manifest (line key -> id), a row whose targets did not all load is left off the sheet, and the sheet is
appended to the sheets index (loop/sheets.jsonl) that M10b reads. Send the .md text as the message, then record that
message with `record_answers.py delivered`.

Usage: python3 scripts/evidence/review_sheet.py --dir <payload dir> --case <case.json> [--mode file|db]
       [--manifest load-manifest.json] [--user <owner>]
"""
import argparse
import collections
import datetime as dt
import json
import os
import string
import sys

import common
import inputs
import payloads
import readers

KEY_KINDS = ('payment', 'source', 'account')
READBACK_DAYS = 7
# results the writer reported and never retried, as the read-back says them (PLAN section 1, runner notes 7/8)
READBACK_NOTES = {
    'human_decision_newer': 'not recorded: your own later decision in the app stands',
    'human_decision_stands': 'not recorded: your own decision in the app stands',
    'not_current': 'not recorded: the item was replaced after the sheet was made',
    'changed_since_review': 'not recorded: the photo moved after the sheet was made',
    'reassign_needs_review': 'not moved to the truck you named: review it in the app',
    'reassign_not_a_placement': 'not moved to the truck you named: a share or a contradiction stays where it is',
    'owner_answer_missing': 'your statement was not recorded: the store found no answer of yours it could cite'}


def label(ctx, vid):
    labels = ctx.case.get('vehicle_labels') or {}
    for alias, v in ctx.vehicles.items():
        if v == vid:
            return '%s (%s, %s)' % (labels.get(alias, alias), alias, vid[:8])
    if vid and not common.is_uuid(vid):
        return vid                                       # a truck with no row: its subject_key
    return vid[:8] if vid else 'none'


def thumb(ctx, image_id, gate):
    """A local thumbnail path for a gate-approved image; any other image is named by id for review in the app."""
    if gate != 'approved':
        return '%s (vision gate %s: review in the app)' % (image_id, gate or 'unknown')
    d = (ctx.case.get('review') or {}).get('thumbnails_dir')
    if d:
        p = ctx.path(d) / ('%s.jpg' % image_id)
        if p.exists():
            return str(p)
    return '%s (no local thumbnail)' % image_id


def T(kind, key, **kw):
    return dict({'kind': kind, 'key': key}, **kw)


def lines_by_key(files):
    out = {}
    for f in ('candidates.photos_album.jsonl', 'candidates.combined.jsonl', 'candidates.listing_class.jsonl',
              'links.album.jsonl', 'links.jsonl', 'change_claims.jsonl', 'account_entities.jsonl',
              'day_context.jsonl', 'time_claims.jsonl'):
        for ln in files.get(f, []):
            out[ln['key']] = ln
    return out


def target_profile(kind, ln):
    """evidence_target_profile over a payload line: the place, frame, link class, image, keys, account and claim kind
    a target carries, and whether its slot is exclusive."""
    if ln is None:
        return {}
    if kind == 'change_claim':
        c = ln['p_claim']
        return {'place': c.get('vehicle_id') or c.get('subject_key'), 'claim_kind': c['kind'], 'exclusive': False}
    r = ln['row']
    if kind == 'image_candidate':
        fr = r.get('frame_role', 'subject')
        return {'place': r.get('vehicle_id') or r.get('subject_key'), 'frame': fr, 'image': r['image_id'],
                'exclusive': fr == 'subject'}
    if kind in ('evidence_link', 'album_map'):
        cls = payloads.link_class(r.get('role'), r.get('allocated_cents'), r.get('source_kind'))
        return {'place': r.get('vehicle_id') or r.get('subject_key'), 'link_class': cls,
                'payment_key': r.get('payment_key'), 'role': r.get('role'),
                'source_key': payloads.source_key(r.get('source_table'), r.get('source_row_id'), r.get('external_ref'),
                                                  r.get('anchor')),
                'exclusive': cls in ('placement', 'album')}
    if kind == 'day_context':
        return {'place': r.get('vehicle_id'), 'exclusive': False}
    if kind == 'account_entity':
        return {'place': 'entity:' + r['entity_key'], 'account': r['account_ref'], 'exclusive': True}
    if kind == 'capture_time_claim':
        return {'place': 'day:' + r['captured_on'], 'image': r['image_id'], 'exclusive': True}
    return {}


def profile(row, lines):
    """evidence_sheet_row over a sheet row: question, asks, asked_place, frame, link_class, and what the row covers.
    Raises ValueError for a row the writer would refuse."""
    q = payloads.row_question(row)
    places, frames, classes, claim_kinds = set(), set(), set(), set()
    images, pkeys, skeys, accts = set(), set(), set(), set()
    for t in row['targets']:
        if t['kind'] == 'image':
            images.add(t['key'])
        elif t['kind'] == 'payment':
            pkeys.add(t['key'])
        elif t['kind'] == 'source':
            skeys.add(t['key'])
        elif t['kind'] == 'account':
            accts.add(t['key'])
        elif t['kind'] == q:
            p = target_profile(q, lines.get(t['key']))
            for s, k in ((places, 'place'), (frames, 'frame'), (classes, 'link_class'), (images, 'image'),
                         (pkeys, 'payment_key'), (skeys, 'source_key'), (accts, 'account'), (claim_kinds, 'claim_kind')):
                if p.get(k):
                    s.add(p[k])
    asks = row.get('asks', 'place')
    frame = None
    if q == 'image_candidate':
        frame = row.get('frame', 'subject') if not frames else (frames.pop() if len(frames) == 1 else 'mixed')
    link = 'album' if q == 'album_map' else None
    if q == 'evidence_link':
        link = 'placement' if not classes else (next(iter(classes)) if len(classes) == 1 else 'mixed')
    asked = None if not places else (next(iter(places)) if len(places) == 1 else 'multi')
    if asks == 'party' and (asked in (None, 'multi') or not (
            (q == 'evidence_link' and link == 'placement') or
            (q == 'change_claim' and len(claim_kinds) == 1 and claim_kinds <= {'acquisition', 'sale'}))):
        raise ValueError('a who-paid row asks about one placement of money or one acquisition or sale, in one place')
    return {'question': q, 'asks': asks, 'asked_place': asked, 'frame': frame, 'link_class': link,
            'places': sorted(places), 'images': sorted(images), 'payment_keys': sorted(pkeys),
            'source_keys': sorted(skeys), 'accounts': sorted(accts)}


def build_rows(ctx, files, read):
    """-> (rows, decisions). A row: {row, section, question_text, targets: [{kind, key[, expected]}], answer_hint, asks,
    profile}; key is a line key for an evidence row, the image id for an image, the payment key, account ref or source
    key."""
    rows, decisions = [], []
    lines = lines_by_key(files)

    def add(section, question, targets, answer_hint=None, asks='place'):
        row = {'row': len(rows) + 1, 'section': section, 'question_text': question, 'targets': targets,
               'answer_hint': answer_hint, 'asks': asks}
        row['profile'] = profile(row, lines)
        rows.append(row)

    def decision(question, hint=None):
        decisions.append({'letter': string.ascii_uppercase[len(decisions) % 26], 'question': question,
                          'answer_hint': hint})

    answered_by_case = set()        # document lines a case who-paid row already asks about (its claim's support)
    for q in (ctx.case.get('review') or {}).get('questions') or []:
        if q.get('targets'):
            add(q.get('section', 'decision'), q['text'], [T(t.get('kind') or t['target_kind'], t['key'])
                                                         for t in q['targets']],
                q.get('answer_hint'), q.get('asks', 'place'))
            if q.get('asks') == 'party':
                for t in rows[-1]['targets']:
                    for s in (lines.get(t['key']) or {}).get('p_support') or []:
                        if s['evidence_kind'] == 'evidence_link' and s['stance'] == 'supports' and \
                                str(s['evidence_id']).startswith('@key:'):
                            answered_by_case.add(s['evidence_id'][5:])
        else:
            decision(q['text'], q.get('answer_hint'))
    links = [ln for f in ('links.album.jsonl', 'links.jsonl') for ln in files.get(f, [])]
    for ln in files.get('links.album.jsonl', []):
        r = ln['row']
        title = next((e.get('title') for e in r['evidence'] if e.get('kind') == 'photos_album'), r['external_ref'])
        add('album', "Is the Photos album '%s' the truck %s?" % (title, label(ctx, r['vehicle_id'])),
            [T('album_map', ln['key'])], 'yes / no / no, it is <truck>')
    for ln in files.get('change_claims.jsonl', []):
        c = ln['p_claim']
        if c['kind'] == 'same_vehicle_as':
            add('identity', 'Is %s the same truck as %s? (If yes, %s is the row to keep.)'
                % (label(ctx, c['vehicle_id']), label(ctx, c['related_vehicle_id']),
                   label(ctx, c.get('survivor_vehicle_id'))),
                [T('change_claim', ln['key'])], 'yes, same truck / no, two trucks')
    imgs = {r['id']: r for r in inputs.image_rows(ctx)} if ctx.input_path('image_rows') else {}
    for ln in files.get('candidates.combined.jsonl', []):
        r = ln['row']
        flag = next((e.get('ref') for e in r['evidence'] if e.get('kind') == 'flag'), None)
        cls = r.get('image_class', 'own')
        if not (r['verdict'] == 'ambiguous' or cls != 'own' or flag):
            continue
        why = flag or ('class ' + cls if cls != 'own' else 'not in the vehicle album')
        img = imgs.get(r['image_id']) or {}
        filed = img.get('vehicle_id', r.get('vehicle_id'))
        add('photos', 'Photo %s (%s, day %s): does it show %s?'
            % (thumb(ctx, r['image_id'], img.get('gate')), why, r.get('pass_captured_on'), label(ctx, r.get('vehicle_id'))),
            [T('image_candidate', ln['key'], expected=filed), T('image', r['image_id'])],
            'yes / no / no, it is <truck>')
    ids = set(read['identity'])
    this = label(ctx, read['identity'][0])

    def placements_here(pk, roles=('payment_out', 'payment_in', 'assertion')):
        return [ln for ln in links if ln['row'].get('payment_key') == pk and ln['row'].get('vehicle_id') in ids
                and ln['row'].get('role') in roles and ln['row'].get('allocated_cents') is None]
    costs = read.get('costs') or {}
    for p in (costs.get('contested') or {}).get('payments') or []:
        here = placements_here(p['payment_key'])
        lab = next((l.get('label') for l in p['links'] if l.get('label')), p['payment_key'])
        others = ', '.join(label(ctx, x) for x in p.get('other_vehicles') or [])
        add('money', "Payment %s (%s) is placed on %s, and a source also places it on %s. Was it %s's?"
            % (p['payment_key'], lab, this, others, this),
            [T('payment', p['payment_key'])] + [T('evidence_link', ln['key']) for ln in here],
            'yes / no / no, it was <truck or job>')
    for p in (costs.get('disputed') or {}).get('payments') or []:
        for l in p['links']:
            if l['role'] != 'contradicts':
                continue
            add('money', 'Payment %s is placed on %s, but %s (%s) says it was for something else. Is that source '
                'right?' % (p['payment_key'], this, l.get('label') or l['kind'], l['ref']),
                [T('evidence_link', l['link_id']), T('payment', p['payment_key'])],
                'yes, it was not for this truck / no, it was for this truck')
    for p in (read.get('money_received') or {}).get('payments') or []:
        if p.get('payer') == 'unknown' or p.get('payee') == 'unknown':
            here = placements_here(p['payment_key'], ('payment_in',))
            add('money', 'Money in %s from %s: was it for %s?' % (p['payment_key'], p.get('from_account_ref')
                                                                  or 'an unknown account', this),
                [T('payment', p['payment_key'])] + [T('evidence_link', ln['key']) for ln in here],
                'yes / no / no, it was for <truck>')
    for u in (costs.get('asserted_unpaid') or {}).get('links') or []:
        if u['link_id'] in answered_by_case:
            continue                    # "who paid for the truck" already asks about its purchase line: one question
        add('who paid', "No payment was found for '%s' (%s). Who paid it: you, one of your businesses (name it), or "
            'another party (name it)? (where the money came from only, not what it was for)'
            % (u.get('label') or u['ref'], u['ref']), [T('evidence_link', u['link_id'])],
            'me / <business> / <other party> / not sure', asks='party')
    for q in read.get('open_questions') or []:
        if q['q'] == 'contradiction':
            c = next((x for x in files.get('change_claims.jsonl', []) if x['key'] == q['claim_id']), None)
            when = ' (%s..%s)' % (c['p_claim'].get('occurred_from'), c['p_claim'].get('occurred_to')) if c else ''
            add('dates', 'The %s claim%s has a source that disagrees about %s. Is the claim right?'
                % (q['kind'], when, ', '.join(q.get('about') or [])), [T('change_claim', q['claim_id'])],
                'yes / no')
        elif q['q'] == 'money_source_behind':
            decision('Account %s: its statements stop at %s while your newest export runs to %s. Is the account closed, '
                     'or is an export missing?' % (q['account_ref'], q.get('coverage_to'), q.get('newest_coverage')),
                     'closed / I will add the export')
    for ln in files.get('account_entities.jsonl', []):
        r = ln['row']
        add('accounts', "Account %s: is it %s's? If not, whose is it: yours, one of your businesses' (name it), or "
            "another party's (name it)?" % (r['account_ref'], r['entity_key']),
            [T('account_entity', ln['key']), T('account', r['account_ref'])], 'yes / no, it is <entity>')
    # (v6, AC10) a row whose reading a second reader, the transcript check or his objection disputed is asked again
    for old, ref in reask(lines):
        add('asked again', old['question_text'], old['targets'], old.get('answer_hint'), old.get('asks', 'place'))
        rows[-1]['reask_of'] = ref
    return rows, decisions


def reask(lines):
    """-> [(old row, {sheet, row})]: the disputed rows of earlier sheets that no delivered sheet has asked again, whose
    targets still exist, once each (manifest.disputed_rows; an entry with no row disputes every answered row)."""
    import manifest
    out, seen = [], manifest.reasked_rows()
    for e in manifest.disputed_rows():
        if not e.get('sheet') or not os.path.exists(e['sheet']):
            continue
        side = common.load_json(e['sheet'])
        if e.get('row'):
            want = [int(e['row'])]
        else:
            rc = os.path.join(os.path.dirname(e['sheet']), 'answers-%s.json' % side.get('date'))
            want = sorted(int(k) for k in common.load_json(rc).get('rows') or {}) if os.path.exists(rc) else \
                [r['row'] for r in side.get('rows') or []]
        for n in want:
            if (e['sheet'], n) in seen:
                continue
            seen.add((e['sheet'], n))
            old = next((r for r in side.get('rows') or [] if r['row'] == n), None)
            if old and all(t['kind'] in KEY_KINDS + ('image',) or t['key'] in lines for t in old['targets']):
                out.append((dict(old, targets=[{k: v for k, v in t.items() if k != 'id'} for t in old['targets']]),
                            {'sheet': e['sheet'], 'row': n}))
    return out


def reading_words(answer, ctx=None):
    """His structured reading in plain words, for the read-back (a truck by its label when the case names it)."""
    d = answer.get('decision')
    if d == 'unsure':
        return 'not sure'
    place = (label(ctx, answer['vehicle_id']) if ctx and answer.get('vehicle_id') else answer.get('vehicle_id')) or \
        answer.get('subject_key') or answer.get('entity_key') or answer.get('captured_on')
    if not place:
        return 'yes' if d == 'confirmed' else 'no'
    return ('yes, %s' if d == 'confirmed' else 'no, it is %s') % place


def readback(date, days=READBACK_DAYS, path=None):
    """What the agent recorded from his answers in the week before this sheet (the read-back list, loop/readback.jsonl,
    appended by record_answers.py decide when it records a decision)."""
    import manifest
    since = (dt.date.fromisoformat(date) - dt.timedelta(days=days)).isoformat()
    return [e for e in manifest.readback_entries(path) if since <= (e.get('recorded_on') or '') < date]


def run_target(t, ids):
    """A sheet target as evidence_open_run stores it, or None when its row did not load (db)."""
    if t['kind'] in KEY_KINDS:
        return payloads.review_target(t['kind'], key=t['key'])
    if t['kind'] == 'image':
        return payloads.review_target('image', ident=t['key'])
    ident = ids.get(t['key'])
    return payloads.review_target(t['kind'], ident=ident) if common.is_uuid(ident or '') else None


def resolve(rows, ids):
    """Keep the rows whose every target loaded, renumbered; -> (rows, left_off). Each kept target gets its id."""
    kept, left = [], []
    for r in rows:
        tgts = [(t, run_target(t, ids)) for t in r['targets']]
        if any(x is None for _t, x in tgts):
            left.append({'question': r['question_text'][:120], 'not_loaded': [t['key'] for t, x in tgts if x is None]})
            continue
        r = dict(r, row=len(kept) + 1, targets=[dict(t, id=x.get('id')) if x.get('id') else t for t, x in tgts])
        kept.append(r)
    return kept, left


def run_row(r, ids):
    """What the review run stores for a row: its targets, its question and what it asks (the writer derives the rest
    and refuses a row that mixes kinds)."""
    out = {'targets': [run_target(t, ids) for t in r['targets']], 'question': r['profile']['question']}
    if r['profile']['asks'] != 'place':
        out['asks'] = r['profile']['asks']
    return out


def run_config(rows, sha, sheet_name, ids):
    return {'sheet_sha256': sha, 'items': len(rows), 'sheet': sheet_name,
            'rows': {str(r['row']): run_row(r, ids) for r in rows}}


def render(ctx, rows, date, decisions=(), read_back=()):
    out = ['# Owner review %s (%s)' % (date, ctx.case.get('case')), '',
           'One answer per numbered row: yes, no, or the one truck, account or party it asks about. Answers are stored '
           'word for word before any decision cites them. Tax or legal characterisation is never asked here.', '']
    if read_back:
        out += ['## What I recorded from your earlier answers (tell me if any is wrong)', '']
        for e in read_back:
            notes = [READBACK_NOTES[k] for k in sorted(e.get('results') or {}) if k in READBACK_NOTES]
            out.append('- Sheet %s row %s (%s): I read "%s" and recorded %s.%s' % (
                e.get('sheet_date'), e.get('row'), e.get('question_kind'), e.get('reading'), e.get('recorded'),
                ''.join(' (%s)' % n for n in notes)))
        out.append('')
    section = None
    for r in rows:
        if r['section'] != section:
            section = r['section']
            out += ['## ' + section, '']
        out.append('%d. %s' % (r['row'], r['question_text']))
        if r.get('answer_hint'):
            out.append('   (answer: %s)' % r['answer_hint'])
        out.append('')
    if decisions:
        out += ['## Decisions (answered in OWNER-DECISIONS; no evidence row)', '']
        for d in decisions:
            out.append('%s. %s' % (d['letter'], d['question']))
            if d.get('answer_hint'):
                out.append('   (answer: %s)' % d['answer_hint'])
            out.append('')
    return '\n'.join(out)


def issue(ctx, rows, decisions, date, out_dir, mode=common.FILE, rest=None, uid=None, ids=None, index=None):
    """Write the sheet and its sidecar; in db mode open and close its review run with the per-row targets first and
    append the sheet to the sheets index (M10b matches its delivery by sha256)."""
    left = []
    if mode == common.DB:
        rows, left = resolve(rows, ids or {})
    back = readback(date)
    md = render(ctx, rows, date, decisions, back)
    md_path = os.path.join(str(out_dir), 'review-%s.md' % date)
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write(md)
    sha = common.sha256_bytes(md.encode('utf-8'))
    side = {'sheet': md_path, 'sheet_sha256': sha, 'items': len(rows), 'date': date, 'sheet_run': None, 'rows': rows,
            'decisions': list(decisions), 'read_back': back, 'left_off_not_loaded': left, 'delivery': None}
    if mode == common.DB and rows:
        side['sheet_run'] = rest.rpc('evidence_open_run', payloads.open_run(
            uid, 'review', 'review_sheet', common.producer('review_sheet.py'), common.code_version(),
            run_config(rows, sha, os.path.basename(md_path), ids or {})))
        # the sheet is issued as stored: close its run (answers cite it by id; its status does not gate them)
        rest.rpc('evidence_close_run', payloads.close_run(side['sheet_run'], 'done', {'items': len(rows)}))
        append_index({'event': 'issued', 'sheet_run': side['sheet_run'], 'sheet_sha256': sha,
                      'sidecar': os.path.join(str(out_dir), 'review-%s.json' % date)}, index)
    common.dump_json(os.path.join(str(out_dir), 'review-%s.json' % date), side)
    return side


def sheets_index(index=None):
    return str(index or common.loop_file('sheets.jsonl', 'EVIDENCE_SHEETS_INDEX'))


def append_index(rec, index=None):
    """The sheets index M10b reads: one line when a sheet is issued, one when its delivery message is recorded."""
    path = sheets_index(index)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'a', encoding='utf-8') as f:
        f.write(json.dumps(dict(rec, at=common.iso_utc(common.utc_now())), sort_keys=True) + '\n')


def load_index(index=None):
    """{sheet_run: {sheet_sha256, sidecar, delivered_ref, issued_at, delivered_at}} from the sheets index."""
    path = sheets_index(index)
    out = collections.OrderedDict()
    if os.path.exists(path):
        for e in common.read_jsonl(path):
            rec = out.setdefault(e['sheet_run'], {})
            rec.update({k: v for k, v in e.items() if k not in ('event', 'at')})
            rec[e['event'] + '_at'] = e.get('at')
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--dir', required=True)
    ap.add_argument('--case', required=True)
    ap.add_argument('--mode', choices=[common.FILE, common.DB], default=common.FILE)
    ap.add_argument('--date', default=None)
    ap.add_argument('--user')
    ap.add_argument('--manifest', help='load-manifest.json (db mode: target ids)')
    a = ap.parse_args()
    ctx = common.Context(a.case, a.dir, mode=a.mode)
    payloads.use_contract(ctx.contract)
    date = a.date or common.today()
    files = readers.load_files(a.dir)
    read = readers.accounting(files, ctx.vid(ctx.case['vehicle']), sessions=readers.sessions_of(ctx))
    rows, decisions = build_rows(ctx, files, read)
    rest = uid = ids = None
    if a.mode == common.DB:
        rest, uid = common.Rest(), common.owner_id(a.user)
        ids = (common.load_json(a.manifest or os.path.join(a.dir, 'load-manifest.json')).get('ids') or {})
    side = issue(ctx, rows, decisions, date, a.dir, a.mode, rest, uid, ids)
    print('review sheet %s: %d rows (%d left off: not loaded), %d decisions, %d read back, sha256 %s, run %s' % (
        side['sheet'], side['items'], len(side['left_off_not_loaded']), len(decisions), len(side['read_back']),
        side['sheet_sha256'], side['sheet_run'] or '(file mode)'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
