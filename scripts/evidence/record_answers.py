"""Owner answers to a review sheet (PLAN K30-4): store his words first, then record decisions that cite them.

store   his reply, split per sheet row ({"<row>": "<his words>"}, a local file), is stored verbatim with
        evidence_record_answers(owner, sheet run, message ref, rows): one review_answers run, the sha256 of each
        answer computed in the database (the receipt here carries the same sha256, computed the same way, and never
        the text: his words may hold amounts or names and belong only in the owner-private store).
decide  each decision the lead takes from an answer is decide_evidence on the agent channel: review_ref
        review:<sheet run>#<row> (the question) and answer_ref answers:<answers run>#<same row> (his stored words);
        image decisions carry expected = the filing he saw. A row with no stored answer cannot be decided.
        A plan line: {"row", "decision": confirmed|rejected, "target_kind", "targets": [keys] (default: the row's
        targets of that kind), "reason", "reassign_vehicle": <alias or uuid>}.
        File mode writes decisions-<date>.json, which the file-mode readers apply to show the confirmed level.

Usage:
  record_answers.py store  --sheet review-<date>.json --answers <answers.json> --message-ref <session>:<message uuid>
  record_answers.py decide --sheet review-<date>.json --receipt answers-<date>.json --plan <plan.json>
                           --agent-session <id> [--manifest load-manifest.json]
  (both take --mode file|db, --case <case.json> and --user)
"""
import argparse
import os
import sys

import checks
import common
import payloads


def validate_answers(sheet, answers):
    items = int(sheet['items'])
    out = {}
    for k, v in answers.items():
        if not str(k).isdigit() or not 1 <= int(k) <= items:
            raise SystemExit('answer row %s is not a row of the sheet (1..%d)' % (k, items))
        if not isinstance(v, str) or not v.strip():
            raise SystemExit('answer row %s has no verbatim text' % k)
        out[str(int(k))] = v
    if not out:
        raise SystemExit('no answers')
    return out


def store(a, ctx):
    sheet = common.load_json(a.sheet)
    answers = validate_answers(sheet, common.load_json(a.answers))
    if not a.message_ref.strip():
        raise SystemExit('--message-ref is required (claude session id:message uuid, or the stored reply file)')
    receipt = {'sheet': a.sheet, 'sheet_sha256': sheet['sheet_sha256'], 'sheet_run': sheet.get('sheet_run'),
               'message_ref': a.message_ref, 'rows': {k: {'sha256': common.sha256_text(v)} for k, v in answers.items()},
               'answers_run': None, 'mode': a.mode}
    if a.mode == common.DB:
        if not sheet.get('sheet_run'):
            raise SystemExit('the sheet has no review run: issue it with review_sheet.py --mode db first')
        rest = common.Rest()
        receipt['answers_run'] = rest.rpc('evidence_record_answers', payloads.record_answers(
            common.owner_id(a.user), sheet['sheet_run'], a.message_ref, answers, common.producer('record_answers.py'),
            common.code_version()))
    out = os.path.join(os.path.dirname(a.sheet), 'answers-%s.json' % sheet['date'])
    common.dump_json(out, receipt)
    print('stored %d answers (%s) -> %s' % (len(answers), receipt['answers_run'] or 'file mode', out))
    return 0


def _reassign_key(files, link_key, vehicle):
    """decide_evidence's "No, it is Y" for a link: the existing current link for Y with the same source or the same
    payment_key (file-mode simulation of what the writer confirms)."""
    links = [ln for f in ('links.album.jsonl', 'links.jsonl') for ln in files.get(f, [])]
    src = next(ln for ln in links if ln['key'] == link_key)['row']
    skey = payloads.source_key(src.get('source_table'), src.get('source_row_id'), src.get('external_ref'), src.get('anchor'))
    best = None
    for ln in links:
        r = ln['row']
        if r.get('vehicle_id') != vehicle:
            continue
        same = payloads.source_key(r.get('source_table'), r.get('source_row_id'), r.get('external_ref'),
                                   r.get('anchor')) == skey
        if same or (src.get('payment_key') and r.get('payment_key') == src['payment_key']):
            if best is None or same:
                best = ln['key']
    return best


def decide(a, ctx):
    sheet = common.load_json(a.sheet)
    receipt = common.load_json(a.receipt)
    plan = common.load_json(a.plan)
    rows = {r['row']: r for r in sheet['rows']}
    files = checks.load_dir(os.path.dirname(os.path.abspath(a.sheet)))[1] if a.mode == common.FILE else None
    man = common.load_json(a.manifest) if a.manifest else {'ids': {}}
    owner = common.owner_id(a.user) if a.mode == common.DB else '<owner>'
    out, calls = [], []
    for p in plan:
        row = int(p['row'])
        if str(row) not in receipt['rows']:
            raise SystemExit('row %d has no stored answer: store his words first' % row)
        kind = p['target_kind']
        targets = p.get('targets') or [t['key'] for t in rows[row]['targets'] if t['target_kind'] == kind]
        row_keys = {t['key'] for t in rows[row]['targets']}
        if not targets or not set(targets) <= row_keys:
            raise SystemExit('row %d: targets must be targets of that sheet row' % row)
        expected = None
        if kind == 'image_candidate':
            exp = {t['key']: t.get('expected') for t in rows[row]['targets']}
            expected = {k: exp[k] for k in targets}
        reassign = ctx.vid(p['reassign_vehicle']) if p.get('reassign_vehicle') else None
        zero = '00000000-0000-0000-0000-000000000000'
        payloads.decide(kind, targets, p['decision'], p.get('reason', 'owner answer'), receipt.get('sheet_run') or zero,
                        row, receipt.get('answers_run') or zero, owner, a.agent_session, expected=expected,
                        reassign_vehicle_id=reassign)          # shape check in both modes
        if a.mode == common.FILE:
            for k in targets:
                d = {'target': k, 'decision': p['decision'], 'by': 'agent', 'row': row}
                if reassign and kind == 'evidence_link':
                    d['reassign_to'] = _reassign_key(files, k, reassign)
                out.append(d)
            continue
        ids = [man['ids'][k] for k in targets]
        args = payloads.decide(kind, ids, p['decision'], p.get('reason', 'owner answer, row %d' % row),
                               receipt['sheet_run'], row, receipt['answers_run'], owner, a.agent_session,
                               expected={man['ids'][k]: v for k, v in (expected or {}).items()} or None,
                               reassign_vehicle_id=reassign)
        calls.append(args)
    if a.mode == common.DB:
        rest = common.Rest()
        for args in calls:
            res = rest.rpc('decide_evidence', args)
            out.append({'review_ref': args['p_review_ref'], 'answer_ref': args['p_answer_ref'], 'result': res})
    path = os.path.join(os.path.dirname(a.sheet), 'decisions-%s.json' % sheet['date'])
    common.dump_json(path, out)
    print('%d decision(s) %s -> %s' % (len(out), 'recorded' if a.mode == common.DB else 'planned (file mode)', path))
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    for name in ('store', 'decide'):
        s = sub.add_parser(name)
        s.add_argument('--sheet', required=True)
        s.add_argument('--case', required=True)
        s.add_argument('--mode', choices=[common.FILE, common.DB], default=common.FILE)
        s.add_argument('--user')
        if name == 'store':
            s.add_argument('--answers', required=True)
            s.add_argument('--message-ref', required=True)
        else:
            s.add_argument('--receipt', required=True)
            s.add_argument('--plan', required=True)
            s.add_argument('--agent-session', required=True)
            s.add_argument('--manifest')
    a = ap.parse_args()
    ctx = common.Context(a.case, os.path.dirname(os.path.abspath(a.sheet)), mode=a.mode)
    payloads.use_contract(ctx.contract)
    return store(a, ctx) if a.cmd == 'store' else decide(a, ctx)


if __name__ == '__main__':
    sys.exit(main())
