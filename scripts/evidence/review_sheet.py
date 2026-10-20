"""Review sheet (PLAN K30-4, section 5 step 7): one batched owner review with numbered rows.

Rows come from the case's questions (decisions only the owner makes: spend, writers, the Photos order, facts only he
can see) and from the evidence itself: each album map, each identity pair, the photos no album places (as
thumbnails), each contested or disputed payment, the unpaid document lines, money received with an unknown payer or
payee, each claim a source contradicts, and each proposed account mapping. Each row names its targets by line key
(and id once loaded), so the answer can be recorded against exactly that row (record_answers.py).

Thumbnails are referenced by local path only (the case's review.thumbnails_dir/<image id>.jpg); no URL is embedded.
No amounts and no personal contact details appear on the sheet.

The sheet is written as review-<date>.md with a sidecar review-<date>.json (rows and targets). Its sha256 and row
count are computed over the .md bytes. In db mode the review run (evidence_open_run run_kind 'review', pass
'review_sheet', config {sheet_sha256, items}) is opened before anything is sent, and its id goes into the sidecar.

Usage: python3 scripts/evidence/review_sheet.py --dir <payload dir> --case <case.json> [--mode file|db]
"""
import argparse
import collections
import os
import sys

import checks
import common
import payloads
import readers


def label(ctx, vid):
    labels = ctx.case.get('vehicle_labels') or {}
    for alias, v in ctx.vehicles.items():
        if v == vid:
            return '%s (%s, %s)' % (labels.get(alias, alias), alias, vid[:8])
    return vid[:8] if vid else 'none'


def thumb(ctx, image_id):
    d = (ctx.case.get('review') or {}).get('thumbnails_dir')
    if d:
        p = ctx.path(d) / ('%s.jpg' % image_id)
        if p.exists():
            return str(p)
    return '(no local thumbnail: %s)' % image_id


def build_rows(ctx, files, read):
    rows = []

    def add(section, question, targets, answer_hint=None):
        rows.append({'row': len(rows) + 1, 'section': section, 'question': question, 'targets': targets,
                     'answer_hint': answer_hint})

    for q in (ctx.case.get('review') or {}).get('questions') or []:
        add(q.get('section', 'decision'), q['text'], [], q.get('answer_hint'))
    for ln in files.get('links.album.jsonl', []):
        r = ln['row']
        title = next((e.get('title') for e in r['evidence'] if e.get('kind') == 'photos_album'), r['external_ref'])
        add('album', "Is the Photos album '%s' the vehicle %s?" % (title, label(ctx, r['vehicle_id'])),
            [{'target_kind': 'album_map', 'key': ln['key']}], 'yes / no, it is <vehicle>')
    for ln in files.get('change_claims.jsonl', []):
        c = ln['p_claim']
        if c['kind'] == 'same_vehicle_as':
            add('identity', 'Is %s the same truck as %s? If yes, %s is the row to keep.'
                % (label(ctx, c['vehicle_id']), label(ctx, c['related_vehicle_id']),
                   label(ctx, c.get('survivor_vehicle_id'))),
                [{'target_kind': 'change_claim', 'key': ln['key']}], 'same truck / two trucks')
    groups = collections.OrderedDict()
    for ln in files.get('candidates.combined.jsonl', []):
        r = ln['row']
        flag = next((e.get('ref') for e in r['evidence'] if e.get('kind') == 'flag'), None)
        cls = r.get('image_class', 'own')
        if r['verdict'] == 'ambiguous' or cls != 'own' or flag:
            why = flag or ('class ' + cls if cls != 'own' else 'not in the vehicle album')
            groups.setdefault(why, []).append(ln)
    for why, lns in groups.items():
        v = lns[0]['row']['vehicle_id']
        lines = ['%s  day %s' % (thumb(ctx, ln['row']['image_id']), ln['row'].get('pass_captured_on')) for ln in lns]
        add('photos', 'These %d photo(s) (%s): do they show %s? Name the truck if not.\n      %s'
            % (len(lns), why, label(ctx, v), '\n      '.join(lines)),
            [{'target_kind': 'image_candidate', 'key': ln['key'], 'expected': ln['row'].get('vehicle_id')}
             for ln in lns], 'yes / no, it is <vehicle> / per photo')
    costs = read.get('costs') or {}
    for p in (costs.get('contested') or {}).get('payments') or []:
        others = ', '.join(label(ctx, x) for x in p.get('other_vehicles') or [])
        add('money', 'Payment %s is placed on %s and also on %s. Which vehicle was it for?'
            % (p['payment_key'], label(ctx, read['identity'][0]), others),
            [{'target_kind': 'evidence_link', 'key': l['link_id']} for l in p['links']],
            'this vehicle / <other vehicle> / neither')
    for p in (costs.get('disputed') or {}).get('payments') or []:
        against = ', '.join('%s (%s)' % (l.get('label') or l['kind'], l['ref']) for l in p['links']
                            if l['role'] == 'contradicts')
        add('money', 'Payment %s is placed on %s, but another source points elsewhere: %s. Was it for this vehicle?'
            % (p['payment_key'], label(ctx, read['identity'][0]), against),
            [{'target_kind': 'evidence_link', 'key': l['link_id']} for l in p['links']], 'yes / no, it was for <..>')
    unpaid = (costs.get('asserted_unpaid') or {}).get('links') or []
    if unpaid:
        add('money', 'The documents list these lines with no payment found: %s. Were they paid, and from which '
            'account? (where the money went only, not what it was for)' % ', '.join(
                '%s (%s)' % (u.get('label') or u['ref'], u['ref']) for u in unpaid),
            [{'target_kind': 'evidence_link', 'key': u['link_id']} for u in unpaid], 'paid from <account> / not paid')
    for p in (read.get('money_received') or {}).get('payments') or []:
        if p.get('payer') == 'unknown' or p.get('payee') == 'unknown':
            add('money', 'Money in %s from %s: does it belong to this vehicle, and who sent and received it?'
                % (p['payment_key'], p.get('from_account_ref') or 'an unknown account'),
                [{'target_kind': 'evidence_link', 'key': l['link_id']} for l in p['links']],
                'yes, from <who> / no')
    for q in read.get('open_questions') or []:
        if q['q'] == 'contradiction':
            add('dates', 'The %s claim has sources that disagree about %s. Which is right?'
                % (q['kind'], ', '.join(q.get('about') or [])),
                [{'target_kind': 'change_claim', 'key': q['claim_id']}], 'the photos / the document / <date>')
    for ln in files.get('account_entities.jsonl', []):
        r = ln['row']
        add('accounts', 'Is %s %s?' % (r['account_ref'], r['entity_key']),
            [{'target_kind': 'account_entity', 'key': ln['key']}], 'yes / no, it is <owner / business / other>')
    return rows


def render(ctx, rows, date):
    out = ['# Owner review %s (%s)' % (date, ctx.case.get('case')), '',
           'One answer per numbered row. Answers are stored word for word before any decision cites them. '
           'Tax or legal characterisation is never asked here.', '']
    section = None
    for r in rows:
        if r['section'] != section:
            section = r['section']
            out += ['## ' + section, '']
        out.append('%d. %s' % (r['row'], r['question']))
        if r.get('answer_hint'):
            out.append('   (answer: %s)' % r['answer_hint'])
        out.append('')
    return '\n'.join(out)


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
    files = checks.load_dir(a.dir)[1]
    read = readers.accounting(files, ctx.vid(ctx.case['vehicle']))
    rows = build_rows(ctx, files, read)
    man = common.load_json(a.manifest) if a.manifest else {}
    for r in rows:
        for t in r['targets']:
            if man.get('ids', {}).get(t['key']):
                t['id'] = man['ids'][t['key']]
    md = render(ctx, rows, date)
    md_path = os.path.join(a.dir, 'review-%s.md' % date)
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write(md)
    sha = common.sha256_bytes(md.encode('utf-8'))
    side = {'sheet': md_path, 'sheet_sha256': sha, 'items': len(rows), 'date': date, 'sheet_run': None, 'rows': rows}
    if a.mode == common.DB:
        rest = common.Rest()
        uid = common.owner_id(a.user)
        side['sheet_run'] = rest.rpc('evidence_open_run', payloads.open_run(
            uid, 'review', 'review_sheet', common.producer('review_sheet.py'), common.code_version(),
            {'sheet_sha256': sha, 'items': str(len(rows)), 'sheet': os.path.basename(md_path)}))
        # the sheet is issued as stored: close its run (answers cite it by id; status does not gate them)
        rest.rpc('evidence_close_run', payloads.close_run(side['sheet_run'], 'done', {'items': len(rows)}))
    common.dump_json(os.path.join(a.dir, 'review-%s.json' % date), side)
    print('review sheet %s: %d rows, sha256 %s, run %s' % (md_path, len(rows), sha, side['sheet_run'] or '(file mode)'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
