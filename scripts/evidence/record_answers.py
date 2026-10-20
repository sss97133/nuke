"""Owner answers to a review sheet (PLAN pilot step 4): record the sheet's delivery, store his words, record what they
decide, and let a second reader check the readings.

delivered  the message that carried the sheet to him ('<source>:<message id>'; for a Claude session the session id
           and the message uuid). Send the review-<date>.md text as its own message: M10b (and this command, when the
           transcript is on this Mac) matches it to the sheet by sha256. One delivery per sheet. The disputed rows the
           sheet asks again are then marked asked (loop/disputed.jsonl 'reasked'), so later sheets leave them off.
store      his reply, split per sheet row, with evidence_record_answers(owner, sheet run, message ref, rows): one
           answers run per sheet and (v6, AC10) per message; the reply is a later message than the delivery. Each row
           carries his words verbatim and the transcriber's structured reading of them:
             {"<row>": {"verbatim": "<his words>", "answer": {"decision": "confirmed" | "rejected" | "unsure",
                                                            and at most one place, of the row's own dimension}}}
           (v6, AC3/AC4) the place: "vehicle_id" (a vehicle alias or uuid) or "subject_key" on a photo, album or
           money-placement row; "entity_key" on an account row or a who-paid row; "captured_on" on a capture-time row;
           none on a pair, a claim, a share or a contradiction. "Yes" is {confirmed} (or names the asked place), a bare
           "no" is {rejected}, "no, it is Y" is {rejected, Y}, a "where?" row takes {confirmed, <place>}, a who-paid row
           takes {confirmed, entity_key}, "not sure" is {unsure}. The checks are the writer's (evidence_record_answers)
           against the row's profile (review_sheet.py). When the transcript is on this Mac, the delivery and the reply
           are checked first (transcript.py). The local receipt keeps each answer's sha256 and the structured reading,
           never the words: they may hold amounts or names and belong only in the owner-private store.
decide     each decision taken from an answer is decide_evidence on the agent channel: review_ref
           review:<sheet run>#<row>, answer_ref answers:<answers run>#<same row>. It is checked here as the writer
           checks it (v6): the decision kind is the row's question; a who-paid row decides nothing; every target is on
           the row (exact) or in the slot it asks about (another candidate of its photo in the same frame role, another
           link of its payment or source in the same money class, the album, the account, the photo's capture time);
           a bare yes / no decides only exact targets with his decision; a placed answer confirms only at the place he
           named and rejects the asked target or another place in an exclusive slot; a reassign is his "no, it is Y".
           Per-target results (human_decision_newer, human_decision_stands, not_current, changed_since_review) and
           reassign notes (reassign_needs_review, reassign_not_a_placement) are recorded and never retried. In db mode
           each recorded decision joins the read-back list (loop/readback.jsonl) with what the store did, and the next
           sheet reads the week's list back to him; file mode writes the preview readback-<date>.json beside the sheet.
           A plan line: {"row", "target_kind", "targets": [keys] (default: the row's targets of that kind),
           "decision": confirmed|rejected, "reason", "reassign_vehicle": <alias or uuid>}, or
           {"row", "owner_statement": {"role", "occurred_on", "payment_key": true, "amount": [source, ref],
           "source_label", "cost_category", "summary", "supports_claim": <claim key>, "about": "party"}}: (v6, AC9) a
           link resting on his word, answering a who-paid row: it sits at the row's place, cites
           answers:<run>#<row>, names the row target it answers ({"kind": "answers_row_target", "ref": <its id>}) and
           carries the entity his answer names on the paying side.
second-read  (v6, AC10; M10b) "packet" writes the rows and his verbatim words with no reading, for a second reader (a
           separate agent) to read blind; "compare" sets that reading against the stored one: any disagreement marks
           the answers run disputed (loop/disputed.jsonl): its agent rows leave M4a, are never promoted, and the next
           sheet asks the row again.
dispute    his objection to a read-back line marks that answers run disputed the same way.

Usage:
  record_answers.py delivered  --sheet review-<date>.json --message-ref <source>:<message id>
  record_answers.py store      --sheet review-<date>.json --answers <answers.json> --message-ref <source>:<message id>
  record_answers.py decide     --sheet review-<date>.json --receipt answers-<date>.json --plan <plan.json>
                               --agent-session <id> [--manifest load-manifest.json]
  record_answers.py second-read packet  --sheet review-<date>.json --answers <answers.json>
  record_answers.py second-read compare --sheet review-<date>.json --receipt answers-<date>.json --second <read.json>
  record_answers.py dispute    --sheet review-<date>.json --receipt answers-<date>.json --row <n> --message-ref <ref>
  (each takes --case <case.json>; delivered, store and decide take --mode file|db and --user)
"""
import argparse
import collections
import os
import sys

import common
import manifest
import money
import payloads
import readers
import review_sheet
import transcript

ZERO = '00000000-0000-0000-0000-000000000000'


def answers_run_of(receipt):
    """The answers run id: the store's in db mode; in file mode a stand-in derived from the sheet and the message."""
    return receipt.get('answers_run') or common.uuid5('answers', receipt['sheet_sha256'], receipt.get('message_ref'))


# ---------------------------------------------------------------------------------------------------- delivery and store
def delivered(a, ctx):
    sheet = common.load_json(a.sheet)
    ref = (a.message_ref or '').strip()
    bad = payloads.message_ref_problem(ref)
    if bad:
        raise SystemExit(bad)
    d = sheet.get('delivery')
    if d and d.get('message_ref') != ref:
        raise SystemExit('the sheet was delivered by %s; one delivery per sheet (a new message is a new sheet)'
                         % d['message_ref'])
    msg = transcript.find(ref)
    if msg is not None and not transcript.carries_sheet(msg, sheet['sheet_sha256']):
        raise SystemExit('message %s does not carry this sheet as issued: send the review .md text as its own message'
                         % ref)
    first = d is None
    at = d['recorded_at'] if d else common.iso_utc(common.utc_now())
    sheet['delivery'] = {'message_ref': ref, 'recorded_at': at,
                         'transcript': 'checked' if msg is not None else 'not on this Mac'}
    common.dump_json(a.sheet, sheet)
    if first and sheet.get('sheet_run'):
        review_sheet.append_index({'event': 'delivered', 'sheet_run': sheet['sheet_run'], 'delivered_ref': ref})
    if first:
        # (v6, AC10) the disputed rows this sheet asks again are asked: later sheets leave them off
        for r in sheet['rows']:
            if r.get('reask_of'):
                manifest.mark_disputed(dict(r['reask_of'], event='reasked', on_sheet=os.path.abspath(a.sheet),
                                            row_now=r['row'], delivered_ref=ref))
    print('sheet %s delivered by %s (transcript %s)' % (sheet['date'], ref, sheet['delivery']['transcript']))
    return 0


def validate_answers(ctx, sheet, answers):
    """-> {"<row>": {"verbatim", "answer"}} or SystemExit, by the writer's rules and the row's profile (v6)."""
    rows = {str(r['row']): r for r in sheet['rows']}
    mine = set(ctx.vehicles.values())
    out = {}
    for k, v in answers.items():
        if str(k) not in rows:
            raise SystemExit('answer row %s is not a row of the sheet (1..%d)' % (k, int(sheet['items'])))
        if not isinstance(v, dict):
            raise SystemExit('answer row %s: store {"verbatim": <his words>, "answer": {"decision", ...}}' % k)
        if not isinstance(v.get('verbatim'), str) or not v['verbatim'].strip():
            raise SystemExit('answer row %s has no verbatim text' % k)
        ans = dict(v.get('answer') or {})
        if ans.get('vehicle_id') and not common.is_uuid(ans['vehicle_id']):
            ans['vehicle_id'] = ctx.vid(ans['vehicle_id'])
        row = rows[str(k)]
        prof = dict(row.get('profile') or {}, row=row['row'])
        bad = payloads.answer_problem(ans, prof)
        if not bad and ans.get('vehicle_id') and ans['vehicle_id'] not in mine | set(prof.get('places') or []):
            bad = 'vehicle %s is neither his nor on the row' % ans['vehicle_id']             # (v6, AC11)
        if bad:
            raise SystemExit('answer row %s: %s' % (k, bad))
        out[str(int(k))] = {'verbatim': v['verbatim'], 'answer': ans}
    if not out:
        raise SystemExit('no answers')
    return out


def receipt_path(sheet_path, sheet):
    return os.path.join(os.path.dirname(os.path.abspath(sheet_path)), 'answers-%s.json' % sheet['date'])


def stored_refs(sheet_path):
    """Message refs already transcribed (receipts beside the sheet): one message is stored once (AC10)."""
    d = os.path.dirname(os.path.abspath(sheet_path))
    out = set()
    for name in os.listdir(d):
        if name.startswith('answers-') and name.endswith('.json'):
            r = common.load_json(os.path.join(d, name))
            if isinstance(r, dict) and r.get('message_ref'):
                out.add(r['message_ref'])
    return out


def store(a, ctx):
    sheet = common.load_json(a.sheet)
    ref = (a.message_ref or '').strip()
    bad = payloads.message_ref_problem(ref)
    if bad:
        raise SystemExit(bad)
    delivery = (sheet.get('delivery') or {}).get('message_ref')
    if not delivery:
        raise SystemExit('record the message that delivered this sheet first (record_answers.py delivered)')
    if ref == delivery:
        raise SystemExit('his reply is a later message than the one that delivered the sheet')
    if ref in stored_refs(a.sheet):
        raise SystemExit('message %s is already transcribed: a message is stored once' % ref)
    answers = validate_answers(ctx, sheet, common.load_json(a.answers))
    out = receipt_path(a.sheet, sheet)
    if os.path.exists(out) and common.load_json(out).get('sheet_sha256') == sheet['sheet_sha256']:
        raise SystemExit('this sheet already has stored answers (%s): one answer set per sheet; put the rest on a '
                         'new sheet' % out)
    chk = transcript.check(sheet['sheet_sha256'], delivery, ref, {k: v['verbatim'] for k, v in answers.items()})
    if chk['problems'] and chk['checked']:
        raise SystemExit('transcript check: %s' % '; '.join(chk['problems']))
    receipt = {'sheet': os.path.abspath(a.sheet), 'sheet_sha256': sheet['sheet_sha256'],
               'sheet_run': sheet.get('sheet_run'), 'sheet_date': sheet['date'], 'message_ref': ref,
               'delivery_ref': delivery, 'answers_run': None,
               'mode': a.mode, 'transcript': 'checked' if chk['checked'] else 'not on this Mac',
               'rows': {k: {'sha256': common.sha256_text(v['verbatim']), 'answer': v['answer']}
                        for k, v in answers.items()}}
    if a.mode == common.DB:
        if not sheet.get('sheet_run'):
            raise SystemExit('the sheet has no review run: issue it with review_sheet.py --mode db first')
        rest = common.Rest()
        try:
            receipt['answers_run'] = rest.rpc('evidence_record_answers', payloads.record_answers(
                common.owner_id(a.user), sheet['sheet_run'], ref, answers, common.producer('record_answers.py'),
                common.code_version()))
        except common.RpcError as e:
            if e.code == '23505':
                raise SystemExit('the store already holds answers for this sheet or this message: put the rest on a '
                                 'new sheet (%s)' % e.message)
            raise
    common.dump_json(out, receipt)
    print('stored %d answers (%s; transcript %s) -> %s' % (len(answers), receipt['answers_run'] or 'file mode',
                                                            receipt['transcript'], out))
    return 0


# ---------------------------------------------------------------------------------------------------- answer binding
def covers(row, kind, key, lines):
    """evidence_row_covers (v6) over a sheet row: 'exact', 'slot' or None."""
    prof = row.get('profile') or {}
    if prof.get('question') != kind:
        return None
    if any(t['kind'] == kind and t['key'] == key for t in row['targets']) or \
            (kind == 'image_publication' and key in prof.get('images', [])):       # a publication row lists the photo
        return 'exact'
    p = review_sheet.target_profile(kind, lines.get(key))
    if not p:
        return None
    if (kind == 'image_candidate' and p.get('image') in prof.get('images', []) and p.get('frame') == prof.get('frame')) \
            or (kind == 'capture_time_claim' and p.get('image') in prof.get('images', [])) \
            or (kind == 'evidence_link' and p.get('link_class') == prof.get('link_class') and (
                (p.get('payment_key') and p['payment_key'] in prof.get('payment_keys', []))
                or p.get('source_key') in prof.get('source_keys', []))) \
            or (kind == 'album_map' and p.get('source_key') in prof.get('source_keys', [])) \
            or (kind == 'account_entity' and p.get('account') in prof.get('accounts', [])):
        return 'slot'
    return None


def binding_problem(answer, row, kind, targets, decision, reassign, lines):
    """decide_evidence's agent-channel checks (v6), before any call: None when the answer allows the decision."""
    prof = row.get('profile') or {}
    if answer.get('decision') not in ('confirmed', 'rejected'):
        return "his answer is '%s': nothing is decided on it" % answer.get('decision')
    if prof.get('question') != kind:
        return 'the row asks about %s; its answer cannot decide %s' % (prof.get('question'), kind)
    if prof.get('asks') == 'party':
        return 'the row asks who paid or received: it decides nothing (an owner statement answers it)'
    place, asked = payloads.answer_place(answer), prof.get('asked_place')
    if reassign and (decision != 'rejected' or answer['decision'] != 'rejected' or reassign != answer.get('vehicle_id')):
        return 'the reassign vehicle must be the one his "no, it is ..." names'
    for key in targets:
        cov = covers(row, kind, key, lines)
        if cov is None:
            return 'target %s is not on row %d: an answer decides only what its row asked' % (key, row['row'])
        p = review_sheet.target_profile(kind, lines.get(key))
        if place is None:
            ok = cov == 'exact' and decision == answer['decision']
        elif decision == 'confirmed':
            ok = p.get('place') == place
        else:
            ok = (cov == 'exact' and answer['decision'] == 'rejected' and p.get('place') == asked) or \
                 (p.get('exclusive') and p.get('place') != place)
        if not ok:
            return 'his answer to row %d (%s) does not support %s on %s' % (row['row'], answer, decision, key)
    return None


def _reassign_key(lines, kind, key, vehicle):
    """decide_evidence's "No, it is Y" (file-mode simulation): Y's candidate of the same image in the same frame role,
    or Y's unallocated link of the same source or payment in the same role (never a contradiction)."""
    src = lines[key]['row']
    best = None
    for k, ln in lines.items():
        r = ln.get('row') or {}
        if r.get('vehicle_id') != vehicle or k == key:
            continue
        if kind == 'image_candidate' and k.startswith('cand:') and r.get('image_id') == src.get('image_id') and \
                r.get('verdict') in ('is_vehicle', 'listing_evidence') and \
                r.get('frame_role', 'subject') == src.get('frame_role', 'subject'):
            best = best or k
        elif kind == 'evidence_link' and k.startswith('link:') and r.get('role') == src.get('role') and \
                r.get('allocated_cents') is None and r.get('source_kind') != 'photos_album':
            same = review_sheet.target_profile(kind, ln)['source_key'] == \
                review_sheet.target_profile(kind, lines[key])['source_key']
            if same or (src.get('payment_key') and r.get('payment_key') == src['payment_key']):
                if best is None or same:
                    best = k
    return best


# ---------------------------------------------------------------------------------------------------- owner statements
def owner_statement(ctx, sp, row, answer, answers_run, target_ref):
    """(v6, AC9) A link resting on his word: it answers a who-paid row, sits at that row's place, cites
    answers:<run>#<row>, names the row target it answers and carries the entity he named on the paying side."""
    prof = row.get('profile') or {}
    if prof.get('asks') != 'party':
        raise SystemExit('row %d does not ask who paid or received: an owner statement answers a who-paid row' % row['row'])
    if answer.get('decision') != 'confirmed' or not answer.get('entity_key'):
        raise SystemExit('row %d: his answer names nobody who paid or received' % row['row'])
    ref = payloads.answer_ref(answers_run, row['row'])
    amount = payloads.amount_ref(*sp['amount']) if sp.get('amount') else None
    role = sp.get('role', 'payment_out')
    if role in payloads.C['payment_roles'] and amount is None:
        raise SystemExit('row %d: a payment on his word takes its amount from a pinned source ([source, ref])' % row['row'])
    asked = prof.get('asked_place')
    veh, subject = (asked, None) if common.is_uuid(asked or '') else (None, asked)
    paying = 'payee_entity' if payloads.C['payment_roles'].get(role, sp.get('direction')) == 'in' else 'payer_entity'
    link = payloads.evidence_link(
        veh, 'owner_statement', role, 'owner answer, review row %d' % row['row'], sp.get('confidence', 0.95),
        [{'kind': 'owner_answer', 'ref': ref}, {'kind': 'answers_row_target', 'ref': target_ref}], external_ref=ref,
        subject_key=subject, source_label=sp.get('source_label'), occurred_on=sp.get('occurred_on'),
        direction=sp.get('direction'), amount_cents=amount, cost_category=sp.get('cost_category'),
        payment_key=payloads.owner_payment_key(answers_run, row['row']) if sp.get('payment_key') else None,
        summary=sp.get('summary'), **{paying: answer['entity_key']})
    return payloads.line(payloads.link_key(ref, veh, subject), 'propose_evidence_links', 'owner_review', link)


def post_statements(ctx, rest, owner, statements, man, sources, results):
    """db mode: one owner_review run; each statement link through propose_evidence_links (owner_answer_missing is
    reported, never retried), then its support on the claim it closes."""
    run = rest.rpc('evidence_open_run', payloads.open_run(
        owner, ctx.case.get('run_kind', 'pilot'), 'owner_review', common.producer('record_answers.py'),
        common.code_version(), {'rule': 'owner_statement links answer a who-paid row'}))
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
    rest.rpc('evidence_close_run', payloads.close_run(run, 'done', {'statements': len(out), 'results': dict(results)}))
    return out


# ---------------------------------------------------------------------------------------------------- decide
def decide(a, ctx):
    sheet = common.load_json(a.sheet)
    receipt = common.load_json(a.receipt)
    plan = common.load_json(a.plan)
    rows = {r['row']: r for r in sheet['rows']}
    files = readers.load_files(os.path.dirname(os.path.abspath(a.sheet)))
    lines = review_sheet.lines_by_key(files)
    man = common.load_json(a.manifest) if a.manifest else {'ids': {}}
    db = a.mode == common.DB
    if db and not (receipt.get('answers_run') and receipt.get('sheet_run')):
        raise SystemExit('the receipt has no stored answers run: store his answers with --mode db first')
    owner = common.owner_id(a.user) if db else '<owner>'
    answers_run = answers_run_of(receipt)
    sheet_run = receipt.get('sheet_run') or ZERO
    out, calls, statements, back = [], [], [], []
    for p in plan:
        row = int(p['row'])
        stored = receipt['rows'].get(str(row))
        if not stored:
            raise SystemExit('row %d has no stored answer: store his words first' % row)
        answer = stored.get('answer')
        if not answer:
            raise SystemExit('row %d: the stored answer has no structured reading: ask it again on a new sheet' % row)
        if p.get('owner_statement'):
            tgt = next(t for t in rows[row]['targets'] if t['kind'] == rows[row]['profile']['question'])
            ref = (man['ids'].get(tgt['key']) if db else None) or tgt.get('id') or tgt['key']
            ln = owner_statement(ctx, p['owner_statement'], rows[row], answer, answers_run, ref)
            statements.append((row, p['owner_statement'], ln))
            back.append(readback_entry(ctx, sheet, rows[row], answer, 'an owner statement', sheet_run, answers_run))
            continue
        kind = p['target_kind']
        targets = p.get('targets') or [t['key'] for t in rows[row]['targets'] if t['kind'] == kind]
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
        payloads.decide(kind, targets, p['decision'], p.get('reason', 'owner answer'), sheet_run, row, answers_run,
                        owner if db else ZERO, a.agent_session, expected=expected,
                        reassign_vehicle_id=reassign)          # shape check in both modes
        entry = readback_entry(ctx, sheet, rows[row], answer, '%s on %d item(s)%s' % (
            p['decision'], len(targets), (', and %s confirmed' % review_sheet.label(ctx, reassign)) if reassign else ''),
            sheet_run, answers_run)
        back.append(entry)
        if not db:
            for k in targets:
                d = {'target': k, 'decision': p['decision'], 'by': 'agent', 'row': row}
                if reassign and kind in ('evidence_link', 'image_candidate'):
                    d['reassign_to'] = _reassign_key(lines, kind, k, reassign)
                out.append(d)
            continue
        ids = [man['ids'][k] for k in targets]
        calls.append((payloads.decide(kind, ids, p['decision'], p.get('reason', 'owner answer, row %d' % row),
                                      receipt['sheet_run'], row, receipt['answers_run'], owner, a.agent_session,
                                      expected={man['ids'][k]: v for k, v in (expected or {}).items()} or None,
                                      reassign_vehicle_id=reassign), entry))
    results = collections.Counter()
    folder = os.path.dirname(os.path.abspath(a.sheet))
    if db:
        rest = common.Rest()
        for args, entry in calls:
            res = rest.rpc('decide_evidence', args)
            mine = collections.Counter()
            for it in (res or {}).get('items') or []:
                mine[it.get('result')] += 1                # human_decision_newer / _stands: reported, not retried
                if it.get('reassign_note'):
                    mine[it['reassign_note']] += 1         # reassign_needs_review / _not_a_placement: next sheet
            results.update(mine)
            out.append({'review_ref': args['p_review_ref'], 'answer_ref': args['p_answer_ref'], 'result': res})
            manifest.append_readback(dict(entry, results=dict(mine)))     # (v6, AC10) the next sheet reads it back
        if statements:
            done = post_statements(ctx, rest, owner, statements, man, money.Sources(ctx), results)
            out += done
            st_back = {e['row']: e for e in back if e['recorded'] == 'an owner statement'}
            for rec in done:
                manifest.append_readback(dict(st_back[rec['row']], results={rec.get('result') or 'no_result': 1}))
    else:
        if statements:
            common.write_jsonl(os.path.join(folder, 'owner-statements-%s.jsonl' % sheet['date']),
                               [ln for _r, _sp, ln in statements])
        # file mode: what the read-back would say, beside the sheet (nothing is recorded, so nothing joins the list)
        common.dump_json(os.path.join(folder, 'readback-%s.json' % sheet['date']), back)
    common.dump_json(os.path.join(folder, 'decisions-%s.json' % sheet['date']), out)
    print('%d decision(s) %s, %d owner statement(s), %d read-back line(s)%s' % (
        len(calls) if db else len(out), 'recorded' if db else 'planned (file mode)', len(statements), len(back),
        ('  results: %s' % dict(results)) if results else ''))
    return 0


def readback_entry(ctx, sheet, row, answer, recorded, sheet_run, answers_run):
    """One read-back line: the row, his words' reading and what was recorded, with the refs M10b matches it by."""
    n = row['row']
    return {'sheet_date': sheet['date'], 'row': n, 'question_kind': row['profile']['question'],
            'reading': review_sheet.reading_words(answer, ctx), 'recorded': recorded, 'recorded_on': common.today(),
            'review_ref': 'review:%s#%d' % (sheet_run, n), 'answer_ref': payloads.answer_ref(answers_run, n)}


# ---------------------------------------------------------------------------------------------------- second reader
def second_packet(a, ctx):
    """The rows and his verbatim words with no reading: a second reader's blind input (local, never in the repo)."""
    sheet = common.load_json(a.sheet)
    words = common.load_json(a.answers)
    rows = {str(r['row']): r for r in sheet['rows']}
    packet = [{'row': int(k), 'question': rows[k]['question_text'], 'question_kind': rows[k]['profile']['question'],
               'asks': rows[k]['profile']['asks'], 'asked_place': rows[k]['profile']['asked_place'],
               'allowed_places': payloads.answer_dimension(rows[k]['profile']), 'verbatim': v['verbatim'],
               'answer': None} for k, v in sorted(words.items(), key=lambda x: int(x[0]))]
    out = os.path.join(os.path.dirname(os.path.abspath(a.sheet)), 'second-read-%s.json' % sheet['date'])
    common.dump_json(out, packet)
    print('second-reader packet: %d rows -> %s (fill each "answer" without seeing the first reading)' % (len(packet), out))
    return 0


def _norm_reading(ans, ctx):
    ans = dict(ans or {})
    if ans.get('vehicle_id') and not common.is_uuid(ans['vehicle_id']):
        ans['vehicle_id'] = ctx.vid(ans['vehicle_id'])
    return ans


def second_compare(a, ctx):
    receipt = common.load_json(a.receipt)
    second = {str(e['row']): e.get('answer') for e in common.load_json(a.second)}
    run = answers_run_of(receipt)
    disputed = []
    for k, stored in sorted(receipt['rows'].items(), key=lambda x: int(x[0])):
        other = _norm_reading(second.get(k), ctx)
        if other != stored['answer']:
            disputed.append(k)
            manifest.mark_disputed({'answers_run': run, 'sheet_run': receipt.get('sheet_run'),
                                    'sheet': receipt['sheet'], 'row': int(k), 'by': 'second_reader',
                                    'first': stored['answer'], 'second': other})
    print('second reader: %d of %d readings agree; disputed rows %s' % (len(receipt['rows']) - len(disputed),
                                                                       len(receipt['rows']), disputed or 'none'))
    return 1 if disputed else 0


def dispute(a, ctx):
    receipt = common.load_json(a.receipt)
    bad = payloads.message_ref_problem(a.message_ref)
    if bad:
        raise SystemExit(bad)
    if str(a.row) not in receipt['rows']:
        raise SystemExit('row %s has no stored answer on that receipt' % a.row)
    manifest.mark_disputed({'answers_run': answers_run_of(receipt), 'sheet_run': receipt.get('sheet_run'),
                            'sheet': receipt['sheet'], 'row': int(a.row), 'by': 'owner_objection',
                            'message_ref': a.message_ref.strip()})
    print('answers run %s row %s marked disputed (his objection %s)' % (answers_run_of(receipt), a.row, a.message_ref))
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    for name in ('delivered', 'store', 'decide', 'dispute'):
        s = sub.add_parser(name)
        s.add_argument('--sheet', required=True)
        s.add_argument('--case', required=True)
        s.add_argument('--mode', choices=[common.FILE, common.DB], default=common.FILE)
        s.add_argument('--user')
        if name in ('delivered', 'store', 'dispute'):
            s.add_argument('--message-ref', required=True)
        if name == 'store':
            s.add_argument('--answers', required=True)
        if name in ('decide', 'dispute'):
            s.add_argument('--receipt', required=True)
        if name == 'decide':
            s.add_argument('--plan', required=True)
            s.add_argument('--agent-session', required=True)
            s.add_argument('--manifest')
        if name == 'dispute':
            s.add_argument('--row', required=True, type=int)
    sr = sub.add_parser('second-read')
    sr.add_argument('step', choices=['packet', 'compare'])
    sr.add_argument('--sheet', required=True)
    sr.add_argument('--case', required=True)
    sr.add_argument('--answers')
    sr.add_argument('--receipt')
    sr.add_argument('--second')
    a = ap.parse_args()
    ctx = common.Context(a.case, os.path.dirname(os.path.abspath(a.sheet)), mode=getattr(a, 'mode', common.FILE))
    payloads.use_contract(ctx.contract)
    if a.cmd == 'second-read':
        return second_packet(a, ctx) if a.step == 'packet' else second_compare(a, ctx)
    return {'delivered': delivered, 'store': store, 'decide': decide, 'dispute': dispute}[a.cmd](a, ctx)


if __name__ == '__main__':
    sys.exit(main())
