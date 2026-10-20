"""Review sheet (PLAN pilot step 4, section 5 step 7): one batched owner review, one question per numbered row.

(v5, v6 AC1-AC4) Each numbered row asks ONE question, in one dimension, and names its targets, which the review run
stores (config.rows.<n>: targets, question, asks), so his answer is stored against the question it answers:
  album        "Is the album 'X' the truck A?"               the album link                 yes / no / no, it is <truck>
  identity     "Is A the same truck as B?"                    the pair claim                 yes / no
  photo        "Does this photo show A?"                      the candidate and its image    yes / no / no, it is <truck>
  money        "Was payment P A's?"                           P and P's unallocated links    yes / no / no, it was <truck>
               "Is <source> right that P was not A's?"        the contradicting link and P   yes / no
               "Was money in P for A?"                        P and its links on A           yes / no / no, it was <truck>
  who paid     "Who paid <the line or the purchase>?"         one link or one claim          <me / business / party>
               (asks: party; (v8) only money no payment source carries, a jacket line or an order with no bank line,
               or the acquisition / sale claim: a payment with a source line is the account's row; a document line
               that supports a purchase or sale the case already asks "who paid" about is not asked twice)
  dates        "Is the <kind> claim right?"                   the claim                      yes / no
  accounts     "Is account X E's?"                            the map row and the account    yes / no, it is <entity>
The row profile the writer derives (question, asks, asked_place, frame, link_class and the places, images, keys and
accounts it covers; evidence_sheet_row) is computed here too, so record_answers.py can check a reading before it is
stored. A row in several places (asked_place 'multi') or of mixed frames or money classes takes only a bare yes or no;
(v7, D6) a row whose own targets place nothing asks about place 'none' (yes, no, or "no, it is Y"). Questions that
decide no evidence row (spend, the writers, the Photos order; "is account X closed, or is an export missing?" for a
lagging money source; "is there an export of account X?" for an account no statement covers) are listed apart as
lettered decisions, answered in OWNER-DECISIONS.

(v8) His answers decide nothing: record_answers.py stores them word for word and he confirms them himself in the app.
A row whose stored reading a second reader, the transcript check or his objection disputed (loop/disputed.jsonl) is
asked again until a delivered sheet has asked it. (v9, W2) A row asked again from a sent db sheet is stored in the new
review run as {"reask_of": "review:<sheet run>#<row>"}: the writer copies that row exactly as it was frozen (targets,
question, asked place), and the sidecar keeps the frozen row; (v10) a job never sends asked_first (the writer sets it
on a re-ask). (W3) A who-paid row never asks about a line of a payment source ((v10) a bank, card or ledger line, a
payment event, a QB transaction or a journal entry; a P&L line is not one), keyed or not: its payer is its account's.
(M8) A sheet lists at most 10,000 targets. (v10) Two or more current acquisition (or sale) claims on the truck
(acquisition_conflict) are asked one row per claim: is this one the deal?

Photos: one row per image. A thumbnail only for an image the phone's VisionEngine approved (vision_gate_status
'approved'); any other image is listed by id, "review in the app". Thumbnails are local paths (the case's
review.thumbnails_dir/<image id>.jpg); no URL is embedded. No amounts and no personal contact details.

The sheet is review-<date>.md with a sidecar review-<date>.json (rows with targets and profiles, decisions); its sha256
and row count are over the .md bytes. In db mode the review run (evidence_open_run run_kind 'review', pass
'review_sheet', config {sheet_sha256, items, sheet, rows}) is opened (running) before anything is sent, target ids come
from the loader manifest (line key -> id), a row whose targets did not all load is left off the sheet, and the sheet is
appended to the sheets index (loop/sheets.jsonl) that M10b reads. The order, so no reply of his can predate the
sheet's send time: (1) `record_answers.py send` closes the review run (the store's send time, written into the
sidecar) and only then writes the .md (a db sheet is held as review-<date>.unsent until it is sent); (2) post the .md
text as its own message; (3) `record_answers.py delivered` records that message.

Usage: python3 scripts/evidence/review_sheet.py --dir <payload dir> --case <case.json> [--mode file|db]
       [--manifest load-manifest.json] [--user <owner>]
"""
import argparse
import collections
import json
import os
import string
import sys

import common
import inputs
import payloads
import readers

KEY_KINDS = ('payment', 'source', 'account')


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
                'payment_key': r.get('payment_key'), 'role': r.get('role'), 'source_kind': r.get('source_kind'),
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
    images, pkeys, skeys, accts, kinds = set(), set(), set(), set(), set()
    own = 0
    for t in row['targets']:
        if t['kind'] == 'image':
            images.add(t['key'])
        elif t['kind'] == 'payment':
            pkeys.add(t['key'])
        elif t['kind'] == 'source':
            skeys.add(t['key'])
        elif t['kind'] == 'account':
            accts.add(t['key'])
        elif t['kind'] == q == 'image_publication':
            own += 1                                     # a photo: no place of its own
            images.add(t['key'])
        elif t['kind'] == q:
            ln = lines.get(t['key'])
            if ln is None:
                continue                                 # an id that names nothing of his covers only itself
            own += 1
            p = target_profile(q, ln)
            places.add(p.get('place') or 'none')         # (v7, D6) a target that places nothing
            for s, k in ((frames, 'frame'), (classes, 'link_class'), (images, 'image'), (pkeys, 'payment_key'),
                         (skeys, 'source_key'), (accts, 'account'), (claim_kinds, 'claim_kind'), (kinds, 'source_kind')):
                if p.get(k):
                    s.add(p[k])
    asks = row.get('asks', 'place')
    frame = None
    if q == 'image_candidate':
        frame = row.get('frame', 'subject') if not frames else (frames.pop() if len(frames) == 1 else 'mixed')
        if frame not in ('subject', 'also_in_frame', 'mixed') or ('frame' in row and row['frame'] != frame):
            raise ValueError('frame %s does not match the row\'s candidates (%s)' % (row.get('frame'), frame))
    link = 'album' if q == 'album_map' else None
    if q == 'evidence_link':
        link = 'placement' if not classes else (next(iter(classes)) if len(classes) == 1 else 'mixed')
    asked = None if not places else (next(iter(places)) if len(places) == 1 else 'multi')
    if asks == 'party' and (asked in (None, 'multi', 'none') or own != 1 or len(row['targets']) != 1 or not (
            (q == 'evidence_link' and link == 'placement') or
            (q == 'change_claim' and len(claim_kinds) == 1 and claim_kinds <= {'acquisition', 'sale'}))):
        raise ValueError('a who-paid row asks about one placement of money or one acquisition or sale, in one place')
    if asks == 'party' and q == 'evidence_link' and pkeys:
        # (v8) money with a payment source gets its payer from the account map: ask the account's row instead
        raise ValueError('this money has a payment source (%s): ask whose account paid it (an account row), not who '
                         'paid' % ', '.join(sorted(pkeys)))
    if asks == 'party' and q == 'evidence_link' and kinds & set(payloads.C['payment_sources']):
        # (v9, W3; v10 one list) nor a line of a payment source, keyed or not: its payer is its account's
        raise ValueError('this money is a payment source line (%s): ask whose account paid it (an account row), not '
                         'who paid' % ', '.join(sorted(kinds & set(payloads.C['payment_sources']))))
    return {'question': q, 'asks': asks, 'asked_place': asked, 'frame': frame, 'link_class': link,
            'places': sorted(places), 'images': sorted(images), 'payment_keys': sorted(pkeys),
            'source_keys': sorted(skeys), 'accounts': sorted(accts)}


def build_rows(ctx, files, read):
    """-> (rows, decisions). A row: {row, section, question_text, targets: [{kind, key[, expected]}], answer_hint, asks,
    profile}; key is a line key for an evidence row, the image id for an image, the payment key, account ref or source
    key."""
    rows, decisions = [], []
    lines = lines_by_key(files)

    def add(section, text, targets, answer_hint=None, asks='place', frozen=None, **stated):
        row = {'row': len(rows) + 1, 'section': section, 'question_text': text, 'targets': targets,
               'answer_hint': answer_hint, 'asks': asks}
        row.update({k: v for k, v in stated.items() if v is not None})     # question / frame a row states itself
        # (v9, W2) a row asked again from a sent sheet keeps the profile it was frozen with (the writer copies it)
        row['profile'] = frozen or profile(row, lines)
        rows.append(row)

    def decision(question, hint=None):
        decisions.append({'letter': string.ascii_uppercase[len(decisions) % 26], 'question': question,
                          'answer_hint': hint})

    answered_by_case = set()        # document lines a case who-paid row already asks about (its claim's support)
    for q in (ctx.case.get('review') or {}).get('questions') or []:
        if q.get('targets'):
            # a row listing only images states its question ("which truck is this?" is image_candidate) and frame
            add(q.get('section', 'decision'), q['text'], [T(t.get('kind') or t['target_kind'], t['key'])
                                                         for t in q['targets']],
                q.get('answer_hint'), q.get('asks', 'place'), question=q.get('question'), frame=q.get('frame'))
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
        if ((lines.get(u['link_id']) or {}).get('row') or {}).get('source_kind') in payloads.C['payment_sources']:
            continue                    # (v9, W3) a payment source line: its payer is its account's (an account row)
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
        elif q['q'] == 'money_source_missing':
            # (v7, F7a) an account his records name that no export covers
            decision('Account %s: your records name it, but no statement of it has been read. Is there an export to '
                     'add?' % q['account_ref'], 'yes, I will add it / no, there is none')
        elif q['q'] == 'acquisition_conflict':
            # (v10, money F4) two or more current claims of one deal: one yes/no row per claim
            for cid in q.get('claim_ids') or []:
                c = next((x for x in files.get('change_claims.jsonl', []) if x['key'] == cid), None)
                when = ' (%s..%s)' % (c['p_claim'].get('occurred_from'), c['p_claim'].get('occurred_to')) if c else ''
                add('deal', '%s has %d current %s claims. Is the %s claim%s%s the %s?'
                    % (this, len(q['claim_ids']), q['kind'], q['kind'], when,
                       ' (%s)' % c['p_claim']['summary'] if c and c['p_claim'].get('summary') else '', q['kind']),
                    [T('change_claim', cid)], 'yes, this one / no, not this one')
    for ln in files.get('account_entities.jsonl', []):
        r = ln['row']
        add('accounts', "Account %s: is it %s's? If not, whose is it: yours, one of your businesses' (name it), or "
            "another party's (name it)?" % (r['account_ref'], r['entity_key']),
            [T('account_entity', ln['key']), T('account', r['account_ref'])], 'yes / no, it is <entity>')
    # (v6, AC10) a row whose stored reading a second reader, the transcript check or his objection disputed is asked
    # again
    for old, ref, sent_ref in reask(lines):
        if sent_ref:
            # (v9, W2) asked exactly as it was sent: the review run names that row (reask_of) and the writer copies
            # its frozen targets and question; the sidecar keeps them, with their ids, for the reading checks
            add('asked again', old['question_text'], old['targets'], old.get('answer_hint'), old.get('asks', 'place'),
                frozen=old['profile'], question=old.get('question'), frame=old.get('frame'))
            rows[-1]['reask_ref'] = sent_ref
        else:
            add('asked again', old['question_text'], [{k: v for k, v in t.items() if k != 'id'} for t in old['targets']],
                old.get('answer_hint'), old.get('asks', 'place'), question=old.get('question'), frame=old.get('frame'))
        rows[-1]['reask_of'] = ref
    return rows, decisions


def reask(lines):
    """-> [(old row, {sheet, row}, 'review:<sheet run>#<row>' or None)]: the disputed rows of earlier sheets that no
    delivered sheet has asked again, whose targets still exist, once each (manifest.disputed_rows; an entry with no
    row disputes every row its answers run answered). (v9, W2) A row of a sent db sheet is named by its review run and
    row: the writer copies it as it was frozen."""
    import manifest
    import record_answers
    out, seen = [], manifest.reasked_rows()
    for e in manifest.disputed_rows():
        if not e.get('sheet') or not os.path.exists(e['sheet']):
            continue
        side = common.load_json(e['sheet'])
        if e.get('row'):
            want = [int(e['row'])]
        else:
            # (v9) several answers runs per sheet: the rows the disputed run answered
            rcs = [r for r in record_answers.receipts(e['sheet']) if r.get('sheet_sha256') == side.get('sheet_sha256')
                   and record_answers.answers_run_of(r) == e.get('answers_run')]
            want = sorted({int(k) for r in rcs for k in r.get('rows') or {}}) if rcs else \
                [r['row'] for r in side.get('rows') or []]
        for n in want:
            if (e['sheet'], n) in seen:
                continue
            seen.add((e['sheet'], n))
            old = next((r for r in side.get('rows') or [] if r['row'] == n), None)
            if old and all(t['kind'] in KEY_KINDS + ('image',) or t['key'] in lines for t in old['targets']):
                sent = side.get('sheet_run') and (side.get('delivery') or {}).get('message_ref')
                out.append((old, {'sheet': e['sheet'], 'row': n},
                            'review:%s#%d' % (side['sheet_run'], n) if sent else None))
    return out


def run_target(t, ids):
    """A sheet target as evidence_open_run stores it, or None when its row did not load (db)."""
    if t['kind'] in KEY_KINDS:
        return payloads.review_target(t['kind'], key=t['key'])
    if t['kind'] == 'image':
        return payloads.review_target('image', ident=t['key'])
    ident = ids.get(t['key'])
    return payloads.review_target(t['kind'], ident=ident) if common.is_uuid(ident or '') else None


def resolve(rows, ids):
    """Keep the rows whose every target loaded, renumbered; -> (rows, left_off). Each kept target gets its id. (v9) A
    row asked again from a sent sheet keeps the targets it was frozen with."""
    kept, left = [], []
    for r in rows:
        if r.get('reask_ref'):
            kept.append(dict(r, row=len(kept) + 1))
            continue
        tgts = [(t, run_target(t, ids)) for t in r['targets']]
        if any(x is None for _t, x in tgts):
            left.append({'question': r['question_text'][:120], 'not_loaded': [t['key'] for t, x in tgts if x is None]})
            continue
        r = dict(r, row=len(kept) + 1, targets=[dict(t, id=x.get('id')) if x.get('id') else t for t, x in tgts])
        kept.append(r)
    return kept, left


def run_row(r, ids):
    """What the review run stores for a row: its targets, its question and what it asks (the writer derives the rest
    and refuses a row that mixes kinds); (v9, W2) for a row asked again from a sent sheet, only the row it asks again
    (the writer copies that row as it was frozen)."""
    if r.get('reask_ref'):
        return {'reask_of': r['reask_ref']}
    out = {'targets': [run_target(t, ids) for t in r['targets']], 'question': r['profile']['question']}
    if r['profile']['asks'] != 'place':
        out['asks'] = r['profile']['asks']
    if r.get('frame'):
        out['frame'] = r['frame']
    return out


def run_config(rows, sha, sheet_name, ids):
    return {'sheet_sha256': sha, 'items': len(rows), 'sheet': sheet_name,
            'rows': {str(r['row']): run_row(r, ids) for r in rows}}


def render(ctx, rows, date, decisions=()):
    out = ['# Owner review %s (%s)' % (date, ctx.case.get('case')), '',
           'One answer per numbered row: yes, no, or the one truck, account or party it asks about. Your words are '
           'stored as you write them and decide nothing: you confirm each one yourself in the app. Tax or legal '
           'characterisation is never asked here.', '']
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
    """Write the sheet and its sidecar; in db mode open its review run (running) with the per-row targets first and
    append the sheet to the sheets index (M10b matches its delivery by sha256). (v8) The run is closed once, when the
    sheet is sent. (v9) A db sheet is held until then: its text is written as review-<date>.unsent, and
    record_answers.py send closes the run, records the store's send time in the sidecar and only then writes
    review-<date>.md, the text to post. A file-mode sheet has no run: its .md is written now."""
    left = []
    if mode == common.DB:
        rows, left = resolve(rows, ids or {})
    md = render(ctx, rows, date, decisions)
    md_path = os.path.join(str(out_dir), 'review-%s.md' % date)
    sha = common.sha256_bytes(md.encode('utf-8'))
    side = {'sheet': md_path, 'sheet_sha256': sha, 'items': len(rows), 'date': date, 'sheet_run': None, 'rows': rows,
            'decisions': list(decisions), 'left_off_not_loaded': left, 'held': None, 'sent_at': None,
            'delivery': None}
    if mode == common.DB and rows:
        side['sheet_run'] = rest.rpc('evidence_open_run', payloads.open_run(
            uid, 'review', 'review_sheet', common.producer('review_sheet.py'), common.code_version(),
            run_config(rows, sha, os.path.basename(md_path), ids or {})))
        side['held'] = os.path.join(str(out_dir), 'review-%s.unsent' % date)
        append_index({'event': 'issued', 'sheet_run': side['sheet_run'], 'sheet_sha256': sha,
                      'sidecar': os.path.join(str(out_dir), 'review-%s.json' % date)}, index)
    with open(side['held'] or md_path, 'w', encoding='utf-8') as f:
        f.write(md)
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
    print('review sheet %s: %d rows (%d left off: not loaded), %d decisions, sha256 %s, run %s' % (
        side['held'] or side['sheet'], side['items'], len(side['left_off_not_loaded']), len(decisions),
        side['sheet_sha256'], side['sheet_run'] or '(file mode)'))
    if side['held']:
        print('held until sent: record_answers.py send closes its review run and writes %s; post that text only then'
              % side['sheet'])
    return 0


if __name__ == '__main__':
    sys.exit(main())
