"""Owner answers to a review sheet (PLAN pilot step 4): store his words first, then record what they decide.

store   his reply, split per sheet row, is stored with evidence_record_answers(owner, sheet run, message ref, rows):
        one review_answers run per sheet (v4: a later answer goes on a new sheet), the same day he gives it (v5: an
        answer never overrides a decision he makes in the app after it). Each row carries his words verbatim and
        (v5, rules-channels v4 #1) the transcriber's structured reading of them:
          {"<row>": {"verbatim": "<his words>", "answer": {"decision": "confirmed" | "rejected" | "unsure",
                                                            and at most one place he named: "vehicle_id" (a vehicle
                                                            alias or uuid) | "subject_key" | "entity_key"}}}
        e.g. "no, the second truck" -> {"decision": "rejected", "vehicle_id": "<that truck>"}; "a job for the
        family business" -> {"decision": "confirmed", "subject_key": "label:<job>"}; "that account is mine" ->
        {"decision": "confirmed", "entity_key": "owner"}; "not sure" -> {"decision": "unsure"} (nothing is decided).
        The local receipt keeps each answer's sha256 (computed as the database computes it) and the structured
        reading, never the words: they may hold amounts or names and belong only in the owner-private store.
decide  each decision taken from an answer is decide_evidence on the agent channel: review_ref
        review:<sheet run>#<row> and answer_ref answers:<answers run>#<same row>. It is checked here the way the
        writer checks it (evidence_row_covers, evidence_answer_allows): every target is on the row; a bare yes / no
        decides only the row's exact targets with his decision; an answer that names a place confirms only targets
        placed there and rejects only targets placed elsewhere (a 'contradicts' link inverted); a reassign names the
        vehicle his answer names; an 'unsure' answer decides nothing. Per-target results the writer reports
        (human_decision_newer, human_decision_stands, not_current, changed_since_review) are recorded and never
        retried: the next sheet asks again.
        A plan line: {"row", "target_kind", "targets": [keys] (default: the row's targets of that kind),
        "decision": confirmed|rejected, "reason", "reassign_vehicle": <alias or uuid>}, or
        {"row", "owner_statement": {"vehicle", "role", "occurred_on", "side": payer|payee, "payment_key": true,
        "amount": [source, ref], "source_label", "cost_category", "summary", "supports_claim": <claim key>,
        "about": "party"}}: a link resting on his word, citing answers:<run>#<row> (v5: the writer refuses it
        otherwise), its payer or payee the entity his answer names, proposed in an owner_review run.
        File mode writes decisions-<date>.json (and owner-statements-<date>.jsonl), which the file-mode readers
        apply to show the confirmed level.

Usage:
  record_answers.py store  --sheet review-<date>.json --answers <answers.json> --message-ref <session>:<message uuid>
  record_answers.py decide --sheet review-<date>.json --receipt answers-<date>.json --plan <plan.json>
                           --agent-session <id> [--manifest load-manifest.json]
  (both take --mode file|db, --case <case.json> and --user)
"""
import argparse
import collections
import os
import sys

import common
import money
import payloads
import readers

ZERO = '00000000-0000-0000-0000-000000000000'


def validate_answers(ctx, sheet, answers):
    """-> {"<row>": {"verbatim", "answer"}} or SystemExit, by the writer's rules."""
    items = int(sheet['items'])
    out = {}
    for k, v in answers.items():
        if not str(k).isdigit() or not 1 <= int(k) <= items:
            raise SystemExit('answer row %s is not a row of the sheet (1..%d)' % (k, items))
        if not isinstance(v, dict):
            raise SystemExit('answer row %s: store {"verbatim": <his words>, "answer": {"decision", ...}}' % k)
        if not isinstance(v.get('verbatim'), str) or not v['verbatim'].strip():
            raise SystemExit('answer row %s has no verbatim text' % k)
        ans = dict(v.get('answer') or {})
        if ans.get('vehicle_id') and not common.is_uuid(ans['vehicle_id']):
            ans['vehicle_id'] = ctx.vid(ans['vehicle_id'])
        bad = payloads.answer_problem(ans)
        if bad:
            raise SystemExit('answer row %s: %s' % (k, bad))
        out[str(int(k))] = {'verbatim': v['verbatim'], 'answer': ans}
    if not out:
        raise SystemExit('no answers')
    return out


def receipt_path(sheet_path, sheet):
    return os.path.join(os.path.dirname(os.path.abspath(sheet_path)), 'answers-%s.json' % sheet['date'])


def store(a, ctx):
    sheet = common.load_json(a.sheet)
    answers = validate_answers(ctx, sheet, common.load_json(a.answers))
    if not a.message_ref.strip():
        raise SystemExit('--message-ref is required (claude session id:message uuid, or the stored reply file)')
    out = receipt_path(a.sheet, sheet)
    if os.path.exists(out) and common.load_json(out).get('sheet_sha256') == sheet['sheet_sha256']:
        raise SystemExit('this sheet already has stored answers (%s): one answer set per sheet; put the rest on a '
                         'new sheet' % out)
    receipt = {'sheet': a.sheet, 'sheet_sha256': sheet['sheet_sha256'], 'sheet_run': sheet.get('sheet_run'),
               'message_ref': a.message_ref, 'answers_run': None, 'mode': a.mode,
               'rows': {k: {'sha256': common.sha256_text(v['verbatim']), 'answer': v['answer']}
                        for k, v in answers.items()}}
    if a.mode == common.DB:
        if not sheet.get('sheet_run'):
            raise SystemExit('the sheet has no review run: issue it with review_sheet.py --mode db first')
        rest = common.Rest()
        try:
            receipt['answers_run'] = rest.rpc('evidence_record_answers', payloads.record_answers(
                common.owner_id(a.user), sheet['sheet_run'], a.message_ref, answers,
                common.producer('record_answers.py'), common.code_version()))
        except common.RpcError as e:
            if e.code == '23505':
                raise SystemExit('the store already holds answers for this sheet: put the rest on a new sheet')
            raise
    common.dump_json(out, receipt)
    print('stored %d answers (%s) -> %s' % (len(answers), receipt['answers_run'] or 'file mode', out))
    return 0


# ---------------------------------------------------------------------------------------------------- answer binding
def _lines(files):
    out = {}
    for f in ('candidates.photos_album.jsonl', 'candidates.combined.jsonl', 'candidates.listing_class.jsonl',
              'links.album.jsonl', 'links.jsonl', 'change_claims.jsonl', 'account_entities.jsonl',
              'day_context.jsonl'):
        for ln in files.get(f, []):
            out[ln['key']] = ln
    return out


def _skey(r):
    return payloads.source_key(r.get('source_table'), r.get('source_row_id'), r.get('external_ref'), r.get('anchor'))


def target_place(kind, ln):
    """evidence_target_place over a payload line: (place, inverted)."""
    if ln is None:
        return None, False
    if kind == 'change_claim':
        c = ln['p_claim']
        return c.get('vehicle_id') or c.get('subject_key'), False
    r = ln['row']
    if kind == 'image_candidate':
        return r.get('vehicle_id') or r.get('subject_key'), False
    if kind in ('evidence_link', 'album_map'):
        return r.get('vehicle_id') or r.get('subject_key'), r.get('role') == 'contradicts'
    if kind == 'day_context':
        return r.get('vehicle_id'), False
    if kind == 'account_entity':
        return 'entity:' + r['entity_key'], False
    return None, False


def covers(row, kind, key, lines):
    """evidence_row_covers over a sheet row: 'exact', 'covered' or None."""
    tg = row['targets']
    if any(t['target_kind'] == kind and t['key'] == key for t in tg):
        return 'exact'
    ln = lines.get(key)
    r = (ln or {}).get('row') or {}
    if kind == 'image_candidate' and r:
        same = {k for k, x in lines.items() if (x.get('row') or {}).get('image_id') == r['image_id']}
        if any((t['target_kind'] == 'image' and t['key'] == r['image_id']) or
               (t['target_kind'] == 'image_candidate' and t['key'] in same) for t in tg):
            return 'covered'
    if kind in ('evidence_link', 'album_map') and r:
        pk, sk = r.get('payment_key'), _skey(r)
        for t in tg:
            o = (lines.get(t['key']) or {}).get('row') or {}
            if (t['target_kind'] == 'payment' and pk and t['key'] == pk) or (t['target_kind'] == 'source' and t['key'] == sk) \
                    or (t['target_kind'] in ('evidence_link', 'album_map') and o and
                        (_skey(o) == sk or (pk and o.get('payment_key') == pk))):
                return 'covered'
    if kind == 'account_entity' and r and any(t['target_kind'] == 'account' and t['key'] == r['account_ref'] for t in tg):
        return 'covered'
    return None


def binding_problem(answer, row, kind, targets, decision, reassign, lines):
    """decide_evidence's agent-channel checks (v5), before any call: None when the answer allows the decision."""
    if answer.get('decision') not in ('confirmed', 'rejected'):
        return "his answer is '%s': nothing is decided on it" % answer.get('decision')
    place = payloads.answer_place(answer)
    if reassign and reassign != answer.get('vehicle_id'):
        return 'the reassign vehicle must be the one his answer names'
    for key in targets:
        cov = covers(row, kind, key, lines)
        if cov is None:
            return 'target %s is not on row %d: an answer decides only what its row asked' % (key, row['row'])
        tplace, inverted = target_place(kind, lines.get(key))
        eff = ({'confirmed': 'rejected', 'rejected': 'confirmed'}[decision]) if inverted else decision
        if place is None:
            ok = cov == 'exact' and decision == answer['decision']
        elif eff == 'confirmed':
            ok = tplace == place
        else:
            ok = tplace != place
        if not ok:
            return 'his answer to row %d (%s) does not support %s on %s' % (row['row'], answer, decision, key)
    return None


def _reassign_key(lines, kind, key, vehicle):
    """decide_evidence's "No, it is Y" (file-mode simulation): the current candidate of the same image for Y, or the
    link for Y with the same source or the same payment_key."""
    src = lines[key]['row']
    best = None
    for k, ln in lines.items():
        r = ln.get('row') or {}
        if r.get('vehicle_id') != vehicle or k == key:
            continue
        if kind == 'image_candidate' and r.get('image_id') == src.get('image_id') and \
                r.get('verdict') in ('is_vehicle', 'listing_evidence') and k.startswith('cand:'):
            best = best or k
        elif kind == 'evidence_link' and k.startswith('link:'):
            same = _skey(r) == _skey(src)
            if same or (src.get('payment_key') and r.get('payment_key') == src['payment_key']):
                if best is None or same:
                    best = k
    return best


# ---------------------------------------------------------------------------------------------------- owner statements
def owner_statement(ctx, sp, row, answer, answers_run):
    """A link resting on his word (el_owner_word_cited): external_ref and 'owner:' key cite his stored answer, and
    the payer / payee is the entity his answer names."""
    if answer.get('decision') not in ('confirmed', 'rejected'):
        raise SystemExit('row %d: an unsure answer supports no statement' % row)
    side = sp.get('side')
    if side and not answer.get('entity_key'):
        raise SystemExit('row %d: his answer names no entity for the %s' % (row, side))
    ref = payloads.answer_ref(answers_run, row)
    amount = payloads.amount_ref(*sp['amount']) if sp.get('amount') else None
    role = sp.get('role', 'payment_out')
    if role in payloads.C['payment_roles'] and amount is None:
        raise SystemExit('row %d: a payment on his word takes its amount from a pinned source ([source, ref])' % row)
    veh = ctx.vid(sp.get('vehicle'))
    link = payloads.evidence_link(
        veh, 'owner_statement', role, 'owner answer, review row %d' % row, sp.get('confidence', 0.95),
        [{'kind': 'owner_answer', 'ref': ref}], external_ref=ref, subject_key=sp.get('subject_key'),
        source_label=sp.get('source_label'), occurred_on=sp.get('occurred_on'), direction=sp.get('direction'),
        amount_cents=amount, cost_category=sp.get('cost_category'),
        payment_key=payloads.owner_payment_key(answers_run, row) if sp.get('payment_key') else None,
        payer_entity=answer.get('entity_key') if side == 'payer' else None,
        payee_entity=answer.get('entity_key') if side == 'payee' else None, summary=sp.get('summary'))
    return payloads.line(payloads.link_key(ref, veh, sp.get('subject_key')), 'propose_evidence_links', 'owner_review',
                         link)


def decide(a, ctx):
    sheet = common.load_json(a.sheet)
    receipt = common.load_json(a.receipt)
    plan = common.load_json(a.plan)
    rows = {r['row']: r for r in sheet['rows']}
    files = readers.load_files(os.path.dirname(os.path.abspath(a.sheet)))
    lines = _lines(files)
    man = common.load_json(a.manifest) if a.manifest else {'ids': {}}
    db = a.mode == common.DB
    owner = common.owner_id(a.user) if db else '<owner>'
    answers_run = receipt.get('answers_run') or common.uuid5('answers', receipt['sheet_sha256'])
    out, calls, statements = [], [], []
    for p in plan:
        row = int(p['row'])
        stored = receipt['rows'].get(str(row))
        if not stored:
            raise SystemExit('row %d has no stored answer: store his words first' % row)
        answer = stored.get('answer')
        if not answer:
            raise SystemExit('row %d: the stored answer has no structured reading (v5): store it again on a new sheet'
                             % row)
        if p.get('owner_statement'):
            statements.append((row, p['owner_statement'], owner_statement(ctx, p['owner_statement'], row, answer,
                                                                          answers_run)))
            continue
        kind = p['target_kind']
        targets = p.get('targets') or [t['key'] for t in rows[row]['targets'] if t['target_kind'] == kind]
        if not targets:
            raise SystemExit('row %d names no %s target' % (row, kind))
        reassign = ctx.vid(p['reassign_vehicle']) if p.get('reassign_vehicle') else None
        bad = binding_problem(answer, rows[row], kind, targets, p['decision'], reassign, lines)
        if bad:
            raise SystemExit('row %d: %s' % (row, bad))
        expected = None
        if kind == 'image_candidate':
            exp = {t['key']: t.get('expected') for t in rows[row]['targets']}
            expected = {k: exp.get(k, (lines.get(k) or {}).get('row', {}).get('vehicle_id')) for k in targets}
        payloads.decide(kind, targets, p['decision'], p.get('reason', 'owner answer'), receipt.get('sheet_run') or ZERO,
                        row, answers_run, owner if db else ZERO, a.agent_session, expected=expected,
                        reassign_vehicle_id=reassign)          # shape check in both modes
        if not db:
            for k in targets:
                d = {'target': k, 'decision': p['decision'], 'by': 'agent', 'row': row}
                if reassign and kind in ('evidence_link', 'image_candidate'):
                    d['reassign_to'] = _reassign_key(lines, kind, k, reassign)
                out.append(d)
            continue
        ids = [man['ids'][k] for k in targets]
        calls.append(payloads.decide(kind, ids, p['decision'], p.get('reason', 'owner answer, row %d' % row),
                                     receipt['sheet_run'], row, receipt['answers_run'], owner, a.agent_session,
                                     expected={man['ids'][k]: v for k, v in (expected or {}).items()} or None,
                                     reassign_vehicle_id=reassign))
    results = collections.Counter()
    path = os.path.join(os.path.dirname(a.sheet), 'decisions-%s.json' % sheet['date'])
    if db:
        rest = common.Rest()
        for args in calls:
            res = rest.rpc('decide_evidence', args)
            for it in (res or {}).get('items') or []:
                results[it.get('result')] += 1             # human_decision_newer / _stands: reported, not retried
            out.append({'review_ref': args['p_review_ref'], 'answer_ref': args['p_answer_ref'], 'result': res})
        if statements:
            out += post_statements(ctx, rest, owner, statements, man, money.Sources(ctx), results)
    elif statements:
        common.write_jsonl(os.path.join(os.path.dirname(a.sheet), 'owner-statements-%s.jsonl' % sheet['date']),
                           [ln for _r, _sp, ln in statements])
    common.dump_json(path, out)
    print('%d decision(s) %s, %d owner statement(s) -> %s%s' % (
        len(out) - (len(statements) if db else 0), 'recorded' if db else 'planned (file mode)', len(statements), path,
        ('  results: %s' % dict(results)) if results else ''))
    return 0


def post_statements(ctx, rest, owner, statements, man, sources, results):
    """db mode: one owner_review run; each statement link through propose_evidence_links (owner_answer_missing is
    reported, never retried), then its support on the claim it closes."""
    run = rest.rpc('evidence_open_run', payloads.open_run(
        owner, ctx.case.get('run_kind', 'pilot'), 'owner_review', common.producer('record_answers.py'),
        common.code_version(), {'rule': 'owner_statement links cite his stored answer'}))
    out = []
    try:
        for row, sp, ln in statements:
            r = dict(ln['row'])
            if isinstance(r.get('amount_cents'), str):
                r['amount_cents'] = sources.cents(r['amount_cents'])
            res = rest.rpc('propose_evidence_links', {'p_run_id': run, 'p_rows': [r]})
            it = ((res or {}).get('items') or [{}])[0]
            results[it.get('result', 'no_result')] += 1
            rec = {'row': row, 'link': ln['key'], 'result': it.get('result'), 'link_id': it.get('link_id')}
            if it.get('link_id') and sp.get('supports_claim'):
                rec['support_rows'] = rest.rpc('propose_claim_support', {
                    'p_run_id': run, 'p_claim_id': man['ids'][sp['supports_claim']],
                    'p_support': [payloads.support('evidence_link', it['link_id'], 'supports', sp.get('about', 'party'),
                                                   'owner answer, review row %d' % row)]})
            out.append(rec)
    except Exception:
        rest.rpc('evidence_close_run', payloads.close_run(run, 'failed', {'statements': len(out)}))
        raise
    rest.rpc('evidence_close_run', payloads.close_run(run, 'done', {'statements': len(out),
                                                                     'results': dict(results)}))
    return out


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
