"""Review sheet (PLAN pilot step 4, section 5 step 7): one batched owner review, one question per numbered row.

(v5, rules-channels v4 #1) Each numbered row asks ONE question with ONE answer place (one album, one pair, one image,
one payment, one document line, one claim, one account) and names its targets, which the review run stores
(config.rows.<n>.targets) so an answer decides only what its row asked: the exact candidate, link, claim or map ids a
bare yes / no decides, plus the payment key of a payment row, the account of an account row and the image of an image
row (so "no, it is Y" can confirm Y's candidate or link). The account map is one row per account. The case's
questions that decide no evidence row (spend, the writers, the Photos order) are listed apart under "Decisions" with
letters: they are answered in OWNER-DECISIONS, never through decide_evidence.

Photos: one row per image. A thumbnail only for an image the phone's VisionEngine approved (vision_gate_status
'approved'); any other image is listed by id, "review in the app". Thumbnails are local paths (the case's
review.thumbnails_dir/<image id>.jpg); no URL is embedded. No amounts and no personal contact details.

The sheet is review-<date>.md with a sidecar review-<date>.json (rows, targets, decisions); its sha256 and row count
are over the .md bytes. In db mode the review run (evidence_open_run run_kind 'review', pass 'review_sheet', config
{sheet_sha256, items, sheet, rows}) is opened and closed before anything is sent; target ids come from the loader
manifest (line key -> id), and a row whose targets did not all load is left off the sheet (listed in the sidecar).

Usage: python3 scripts/evidence/review_sheet.py --dir <payload dir> --case <case.json> [--mode file|db]
       [--manifest load-manifest.json] [--user <owner>]
"""
import argparse
import collections
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
    return dict({'target_kind': kind, 'key': key}, **kw)


def build_rows(ctx, files, read):
    """-> (rows, decisions). A row: {row, section, question, targets: [{target_kind, key[, expected]}], answer_hint};
    key is a line key for an evidence row, the image id for an image, the payment key, account ref or source key."""
    rows, decisions = [], []

    def add(section, question, targets, answer_hint=None):
        rows.append({'row': len(rows) + 1, 'section': section, 'question': question, 'targets': targets,
                     'answer_hint': answer_hint})

    for q in (ctx.case.get('review') or {}).get('questions') or []:
        if q.get('targets'):
            add(q.get('section', 'decision'), q['text'], [T(t['target_kind'], t['key']) for t in q['targets']],
                q.get('answer_hint'))
        else:
            decisions.append({'letter': string.ascii_uppercase[len(decisions) % 26], 'question': q['text'],
                              'answer_hint': q.get('answer_hint')})
    links = [ln for f in ('links.album.jsonl', 'links.jsonl') for ln in files.get(f, [])]
    for ln in files.get('links.album.jsonl', []):
        r = ln['row']
        title = next((e.get('title') for e in r['evidence'] if e.get('kind') == 'photos_album'), r['external_ref'])
        add('album', "Is the Photos album '%s' the vehicle %s?" % (title, label(ctx, r['vehicle_id'])),
            [T('album_map', ln['key'])], 'yes / no / no, it is <vehicle>')
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
        add('photos', 'Photo %s (%s, day %s): does it show %s? If not, which truck?'
            % (thumb(ctx, r['image_id'], img.get('gate')), why, r.get('pass_captured_on'), label(ctx, r.get('vehicle_id'))),
            [T('image_candidate', ln['key'], expected=filed), T('image', r['image_id'])],
            'yes / no / no, it is <vehicle>')
    by_pk = collections.defaultdict(list)
    for ln in links:
        if ln['row'].get('payment_key'):
            by_pk[ln['row']['payment_key']].append(ln)
    this = label(ctx, read['identity'][0])
    costs = read.get('costs') or {}
    for p in (costs.get('contested') or {}).get('payments') or []:
        others = ', '.join(label(ctx, x) for x in p.get('other_vehicles') or [])
        lab = next((l.get('label') for l in p['links'] if l.get('label')), p['payment_key'])
        add('money', 'Payment %s (%s) is placed on %s and also on %s. Which truck was it for?'
            % (p['payment_key'], lab, this, others),
            [T('payment', p['payment_key'])] + [T('evidence_link', ln['key']) for ln in by_pk[p['payment_key']]
                                                if ln['row'].get('role') != 'contradicts'],
            'this truck / <other truck> / neither')
    for p in (costs.get('disputed') or {}).get('payments') or []:
        for l in p['links']:
            if l['role'] != 'contradicts':
                continue
            add('money', 'Payment %s is placed on %s, but %s (%s) says it was for something else. Is that source '
                'right?' % (p['payment_key'], this, l.get('label') or l['kind'], l['ref']),
                [T('evidence_link', l['link_id']), T('payment', p['payment_key'])],
                'yes, it was not for this truck / no, it was for this truck')
    for u in (costs.get('asserted_unpaid') or {}).get('links') or []:
        add('money', "The document line '%s' (%s) has no payment found. Who paid it: you, one of your businesses "
            '(name it), another party (name it), or nobody? (where the money came from only, not what it was for)'
            % (u.get('label') or u['ref'], u['ref']), [T('evidence_link', u['link_id'])],
            'me / <business> / <other party> / not paid')
    for p in (read.get('money_received') or {}).get('payments') or []:
        if p.get('payer') == 'unknown' or p.get('payee') == 'unknown':
            add('money', 'Money in %s from %s: was it for %s?' % (p['payment_key'], p.get('from_account_ref')
                                                                  or 'an unknown account', this),
                [T('payment', p['payment_key'])] + [T('evidence_link', l['link_id']) for l in p['links']],
                'yes / no / no, it was for <vehicle>')
    for q in read.get('open_questions') or []:
        if q['q'] == 'contradiction':
            c = next((x for x in files.get('change_claims.jsonl', []) if x['key'] == q['claim_id']), None)
            when = ' (%s..%s)' % (c['p_claim'].get('occurred_from'), c['p_claim'].get('occurred_to')) if c else ''
            add('dates', 'The %s claim%s has a source that disagrees about %s. Is the claim right?'
                % (q['kind'], when, ', '.join(q.get('about') or [])), [T('change_claim', q['claim_id'])],
                'yes / no')
    for ln in files.get('account_entities.jsonl', []):
        r = ln['row']
        add('accounts', 'Account %s: is it yours, one of your businesses\' (name it), or another party\'s (name it)? '
            '(proposed: %s)' % (r['account_ref'], r['entity_key']),
            [T('account_entity', ln['key']), T('account', r['account_ref'])], 'mine / <business> / <other party>')
    return rows, decisions


def run_target(t, ids):
    """A sheet target as evidence_open_run stores it, or None when its row did not load (db)."""
    if t['target_kind'] in KEY_KINDS:
        return payloads.review_target(t['target_kind'], key=t['key'])
    if t['target_kind'] == 'image':
        return payloads.review_target('image', ident=t['key'])
    ident = ids.get(t['key'])
    return payloads.review_target(t['target_kind'], ident=ident) if common.is_uuid(ident or '') else None


def resolve(rows, ids):
    """Keep the rows whose every target loaded, renumbered; -> (rows, left_off). Each kept target gets its id."""
    kept, left = [], []
    for r in rows:
        tgts = [(t, run_target(t, ids)) for t in r['targets']]
        if any(x is None for _t, x in tgts):
            left.append({'question': r['question'][:120], 'not_loaded': [t['key'] for t, x in tgts if x is None]})
            continue
        r = dict(r, row=len(kept) + 1, targets=[dict(t, id=x.get('id')) if x.get('id') else t for t, x in tgts])
        kept.append(r)
    return kept, left


def run_config(rows, sha, sheet_name, ids):
    return {'sheet_sha256': sha, 'items': len(rows), 'sheet': sheet_name,
            'rows': {str(r['row']): {'targets': [run_target(t, ids) for t in r['targets']]} for r in rows}}


def render(ctx, rows, date, decisions=()):
    out = ['# Owner review %s (%s)' % (date, ctx.case.get('case')), '',
           'One answer per numbered row: yes, no, or the one truck, account or party it names. Answers are stored word '
           'for word before any decision cites them. Tax or legal characterisation is never asked here.', '']
    section = None
    for r in rows:
        if r['section'] != section:
            section = r['section']
            out += ['## ' + section, '']
        out.append('%d. %s' % (r['row'], r['question']))
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


def issue(ctx, rows, decisions, date, out_dir, mode=common.FILE, rest=None, uid=None, ids=None):
    """Write the sheet and its sidecar; in db mode open and close its review run with the per-row targets first."""
    left = []
    if mode == common.DB:
        rows, left = resolve(rows, ids or {})
    md = render(ctx, rows, date, decisions)
    md_path = os.path.join(str(out_dir), 'review-%s.md' % date)
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write(md)
    sha = common.sha256_bytes(md.encode('utf-8'))
    side = {'sheet': md_path, 'sheet_sha256': sha, 'items': len(rows), 'date': date, 'sheet_run': None, 'rows': rows,
            'decisions': list(decisions), 'left_off_not_loaded': left}
    if mode == common.DB and rows:
        side['sheet_run'] = rest.rpc('evidence_open_run', payloads.open_run(
            uid, 'review', 'review_sheet', common.producer('review_sheet.py'), common.code_version(),
            run_config(rows, sha, os.path.basename(md_path), ids or {})))
        # the sheet is issued as stored: close its run (answers cite it by id; its status does not gate them)
        rest.rpc('evidence_close_run', payloads.close_run(side['sheet_run'], 'done', {'items': len(rows)}))
    common.dump_json(os.path.join(str(out_dir), 'review-%s.json' % date), side)
    return side


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
        side['sheet'], side['items'], len(side['left_off_not_loaded']), len(decisions), side['sheet_sha256'],
        side['sheet_run'] or '(file mode)'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
