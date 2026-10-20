"""Owner answers to a review sheet (PLAN pilot step 4): record the sheet's delivery, store his words, and let a second
reader check the stored readings. Nothing here decides anything.

(v8) The agent decision channel does not ship. No job calls decide_evidence (service_role has no EXECUTE on it),
writes his word (an owner_statement link, an 'owner:' payment key, a rule 'owner' capture time: owner_answer_missing)
or opens an owner_review run. His chat answers are stored word for word and wait for him: he confirms them himself,
from his own step-up session in the app (evidence_answers_to_confirm lists what waits; the scoreboard's M15 counts it).

The order, so that no reply of his can predate the sheet: send, then post, then delivered.
send       before the sheet is posted: (--mode db) closes its review run once and reads back the store's send time (the
           run's finished_at), writes that time into the sidecar (sent_at), and only then writes review-<date>.md, the
           text to post (a db sheet is held as review-<date>.unsent until now). A file-mode sheet has no run: its send
           time is the local clock. A run the store does not hold 'done' is never posted. Sending again changes nothing.
delivered  after posting: the message that carried the sheet to him ('<source>:<message id>', exactly one colon, no
           path; for a Claude session the session id and the message's own uuid). Post the review-<date>.md text as its
           own message: M10b (and this command, when the transcript is on this Mac) matches it to the sheet by sha256,
           and (v9) a message the transcript dates before the send time is refused. One delivery per sheet. The disputed
           rows the sheet asks again are marked asked (loop/disputed.jsonl 'reasked'), so later sheets leave them off.
store      one message of his reply, split per sheet row, with evidence_record_answers(owner, sheet run, message ref,
           rows, message time): (v9) one answers run per chat message, several per sheet (a reply spread over several
           messages is stored message by message on the sheet it answers, one receipt each), written closed. The store
           keys the message id across every user; the message is a later one than the delivery and was written after
           the sheet was sent ('message_predates_sheet'); a sheet never sent takes nothing ('sheet_not_sent'). The
           message time is the transcript's when it is on this Mac, else --message-at as the chat shows it, never the
           time of storing. Each row carries his words verbatim (at most 20,000 characters) and, when the transcriber
           has one, a structured reading:
             {"<row>": {"verbatim": "<his words>"[, "answer": {"decision": "confirmed" | "rejected" | "unsure", and at
                                                               most one place, of the row's own dimension}]}}
           Without a reading the store keeps his words alone, marked unread. A reading names "vehicle_id" (a vehicle
           alias or uuid: his own truck, or one on the row) or "subject_key" on a photo, album or money-placement row;
           "entity_key" on an account row or a who-paid row; "captured_on" on a capture-time row; none on a pair, a
           claim, a share or a contradiction. "Yes" is {confirmed} (or names the asked place), a bare "no" is
           {rejected}, "no, it is Y" is {rejected, Y}, a "where?" row takes {confirmed, <place>}, a row that asks about
           place 'none' takes yes, no or "no, it is Y", a who-paid row takes {confirmed, entity_key}, "not sure" is
           {unsure}. The checks are the writer's (evidence_record_answers) against the row's profile (review_sheet.py).
           When the transcript is on this Mac, the delivery and the reply are checked first (transcript.py). The local
           receipt keeps each answer's sha256 and its reading, never the words: they may hold amounts or names and
           belong only in the owner-private store. The store's refusals are reported, never retried.
second-read  (M10b) "packet" writes the rows and his verbatim words with no reading, for a second reader (a separate
           agent) to read blind; "compare" sets that reading against each stored reading: a disagreement marks the
           answers run disputed (loop/disputed.jsonl) and the next sheet asks the row again. Rows stored unread are
           left out (there is no reading to check).
dispute    his objection to a stored reading marks that answers run disputed the same way.
decide     retired (v8): decisions are his alone, in the app.

Usage:
  record_answers.py send       --sheet review-<date>.json [--mode file|db] [--user <owner>]
  record_answers.py delivered  --sheet review-<date>.json --message-ref <source>:<message id>
  record_answers.py store      --sheet review-<date>.json --answers <answers.json> --message-ref <source>:<message id>
                               [--message-at <ISO 8601 time of that message, when its transcript is not on this Mac>]
  record_answers.py second-read packet  --sheet review-<date>.json --answers <answers.json>
  record_answers.py second-read compare --sheet review-<date>.json --receipt answers-<date>-<message>.json
                                        --second <read.json>
  record_answers.py dispute    --sheet review-<date>.json --receipt answers-<date>-<message>.json --row <n>
                               --message-ref <ref>
  (each takes --case <case.json>; send and store take --mode file|db and --user)
"""
import argparse
import datetime as dt
import os
import re
import sys

import common
import manifest
import payloads
import review_sheet
import transcript

UNREAD = {'decision': 'unsure', 'unread': True}          # how the store keeps a row with his words alone
FUTURE_SLACK = dt.timedelta(seconds=5)                   # evidence_record_answers: a message time from the future


def answers_run_of(receipt):
    """The answers run id: the store's in db mode; in file mode a stand-in derived from the sheet and the message."""
    return receipt.get('answers_run') or common.uuid5('answers', receipt['sheet_sha256'], receipt.get('message_ref'))


def sent_at(sheet):
    """(v9) When the sheet was sent: the store's send time, recorded by `send` before the sheet was posted."""
    return sheet.get('sent_at')


def send_time(sheet, uid, reader=None):
    """The store's send time of a db sheet: its review run's finished_at, once the run is 'done' (read back through
    q.sh; the writer compares every message time with it)."""
    reader = reader or common.Reader()
    rows = reader.read('select status, finished_at from evidence_runs where id = :run and user_id = :uid',
                       {'run': sheet['sheet_run'], 'uid': uid}, tag='sheet_sent')
    if not rows or rows[0].get('status') != 'done' or not rows[0].get('finished_at'):
        raise SystemExit('review run %s is %s, not sent: do not post this sheet (a withdrawn sheet takes no answers)'
                         % (sheet['sheet_run'], (rows[0].get('status') if rows else 'missing')))
    return common.parse_ts(rows[0]['finished_at']).astimezone(dt.timezone.utc).isoformat()     # to the microsecond


# ---------------------------------------------------------------------------------------------------- sending, delivery and store
def send(a, ctx):
    sheet = common.load_json(a.sheet)
    if sent_at(sheet):
        print('sheet %s was sent at %s: post %s as its own message, then record it with delivered'
              % (sheet['date'], sent_at(sheet), sheet['sheet']))
        return 0
    if sheet.get('sheet_run'):
        if getattr(a, 'mode', common.FILE) != common.DB:
            raise SystemExit('the sheet has a review run: send it with --mode db, which closes the run')
        try:
            # (v8) a review run is opened running and closed once, when its sheet is sent
            common.Rest().rpc('evidence_close_run', payloads.close_run(
                sheet['sheet_run'], 'done', {'items': sheet['items'], 'sent': True}))
        except common.RpcError as e:
            if 'is not a running run' not in (e.message or ''):
                raise
        at = send_time(sheet, common.owner_id(getattr(a, 'user', None)))
    else:
        at = common.iso_utc(common.utc_now())             # a file-mode sheet: no run, the local clock
    if sheet.get('held'):
        os.replace(sheet['held'], sheet['sheet'])         # the text to post exists only now
    sheet['held'], sheet['sent_at'] = None, at
    common.dump_json(a.sheet, sheet)
    if sheet.get('sheet_run'):
        review_sheet.append_index({'event': 'sent', 'sheet_run': sheet['sheet_run'], 'sent_time': at})
    print('sheet %s sent at %s%s: post %s now as its own message, then record it with delivered' % (
        sheet['date'], at, ' (review run closed)' if sheet.get('sheet_run') else '', sheet['sheet']))
    return 0


def delivered(a, ctx):
    sheet = common.load_json(a.sheet)
    ref = payloads.norm_ref(a.message_ref)
    bad = payloads.message_ref_problem(ref)
    if bad:
        raise SystemExit(bad)
    if not sent_at(sheet):
        raise SystemExit('the sheet was not sent: run record_answers.py send first (it closes the review run and '
                         'records the send time), and post the sheet only after that')
    d = sheet.get('delivery')
    if d and d.get('message_ref') != ref:
        raise SystemExit('the sheet was delivered by %s; one delivery per sheet (a new message is a new sheet)'
                         % d['message_ref'])
    first = d is None
    msg = transcript.find(ref)
    if msg is not None and not transcript.carries_sheet(msg, sheet['sheet_sha256']):
        raise SystemExit('message %s does not carry this sheet as issued: send the review .md text as its own message'
                         % ref)
    posted = payloads.message_time((msg or {}).get('timestamp')) if msg else None
    if posted is not None and posted < common.parse_ts(sent_at(sheet)):
        raise SystemExit('message %s was posted at %s, before the sheet was sent (%s): replies written before the send '
                         'time cannot be stored on it; issue a new sheet' % (ref, common.iso_utc(posted),
                                                                            sent_at(sheet)))
    sheet['delivery'] = d or {'message_ref': ref, 'recorded_at': common.iso_utc(common.utc_now())}
    sheet['delivery']['transcript'] = 'checked' if msg is not None else 'not on this Mac'
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


def answer_scope(ctx):
    """The trucks a reading may name besides the row's own places: his own (the case's base_scope, else every case
    vehicle). The store counts his confirmed relations only (v7, D7)."""
    base = ctx.case.get('base_scope')
    return {ctx.vid(x) for x in base} if base else set(ctx.vehicles.values())


def validate_answers(ctx, sheet, answers):
    """-> {"<row>": {"verbatim"[, "answer"]}} or SystemExit, by the writer's rules and the row's profile (v6-v9)."""
    rows = {str(r['row']): r for r in sheet['rows']}
    mine = answer_scope(ctx)
    out = {}
    for k, v in answers.items():
        if str(k) not in rows:
            raise SystemExit('answer row %s is not a row of the sheet (1..%d)' % (k, int(sheet['items'])))
        if not isinstance(v, dict):
            raise SystemExit('answer row %s: store {"verbatim": <his words>[, "answer": {"decision", ...}]}' % k)
        if not isinstance(v.get('verbatim'), str) or not v['verbatim'].strip():
            raise SystemExit('answer row %s has no verbatim text' % k)
        if len(v['verbatim']) > payloads.C['verbatim_max']:
            raise SystemExit('answer row %s: at most %d characters of his words per row (v9)'
                             % (k, payloads.C['verbatim_max']))
        stored = {'verbatim': v['verbatim']}
        if v.get('answer') is not None:                  # (v8) the reading is optional
            ans = dict(v['answer']) if isinstance(v['answer'], dict) else v['answer']
            try:
                if isinstance(ans, dict) and ans.get('vehicle_id') and not common.is_uuid(ans['vehicle_id']):
                    ans['vehicle_id'] = ctx.vid(ans['vehicle_id'])
            except common.EvidenceError as e:
                raise SystemExit('answer row %s: %s' % (k, e))
            row = rows[str(k)]
            prof = dict(row.get('profile') or {}, row=row['row'])
            bad = payloads.answer_problem(ans, prof)
            if not bad and ans.get('vehicle_id') and ans['vehicle_id'] not in mine | set(prof.get('places') or []):
                bad = 'vehicle %s is neither his nor on the row' % ans['vehicle_id']             # (v6, AC11; v7, D7)
            if bad:
                raise SystemExit('answer row %s: %s' % (k, bad))
            stored['answer'] = ans
        out[str(int(k))] = stored
    if not out:
        raise SystemExit('no answers: a stored answer has at least one row')
    return out


def receipt_path(sheet_path, sheet, ref):
    """(v9) One receipt per message: a reply in several messages is several answers runs on the same sheet."""
    mid = re.sub(r'[^a-z0-9_-]', '_', payloads.message_id(ref))[:80]
    return os.path.join(os.path.dirname(os.path.abspath(sheet_path)), 'answers-%s-%s.json' % (sheet['date'], mid))


def receipts(sheet_path):
    """The answer receipts stored beside a sheet (every sheet in that folder; each names its own sheet)."""
    d = os.path.dirname(os.path.abspath(sheet_path))
    out = []
    for name in sorted(os.listdir(d)):
        if name.startswith('answers-') and name.endswith('.json'):
            r = common.load_json(os.path.join(d, name))
            if isinstance(r, dict) and r.get('message_ref') and r.get('rows') is not None:
                out.append(r)
    return out


def stored_message_ids(sheet_path):
    """Message ids already transcribed (receipts beside the sheet): one message is stored once (AC10; v7, D4)."""
    return {payloads.message_id(r['message_ref']) for r in receipts(sheet_path)}


def message_time(a, ref, sheet):
    """(v9) The message's own time: the transcript's when it is on this Mac (--message-at must then agree), else
    --message-at. Refused here as the writer refuses it: missing, from the future, or older than the sheet's sending."""
    msg = transcript.find(ref)
    given = getattr(a, 'message_at', None)
    given = given if isinstance(given, str) else None
    at = payloads.message_time((msg or {}).get('timestamp')) if msg else None
    if msg is not None and at is None:
        raise SystemExit('the transcript entry of %s carries no time' % ref)
    if given is not None:
        g = payloads.message_time(given)
        if g is None:
            raise SystemExit("--message-at is the message's time as the chat shows it (ISO 8601 with its zone)")
        if at is not None and abs((g - at).total_seconds()) > 1:
            raise SystemExit('--message-at %s is not the time the transcript gives message %s' % (given, ref))
        at = at or g
    if at is None:
        raise SystemExit('the message time is needed (evidence_record_answers p_message_at): the transcript of %s is '
                         'not on this Mac; pass --message-at as the chat shows it (never the time of storing)' % ref)
    if at > common.utc_now() + FUTURE_SLACK:                # a chat message is a real event: the real clock
        raise SystemExit('message time %s is in the future' % common.iso_utc(at))
    sent = sent_at(sheet)
    if sent and at < common.parse_ts(sent):
        raise SystemExit('message_predates_sheet: message %s (written %s) is older than the sheet (sent %s); store it '
                         'on the sheet it answers' % (ref, common.iso_utc(at), sent))
    return at.astimezone(dt.timezone.utc).isoformat()


def store(a, ctx):
    sheet = common.load_json(a.sheet)
    ref = payloads.norm_ref(a.message_ref)
    bad = payloads.message_ref_problem(ref)
    if bad:
        raise SystemExit(bad)
    if not sent_at(sheet):
        raise SystemExit('sheet_not_sent: the sheet was never sent (record_answers.py send, before it is posted)')
    delivery = (sheet.get('delivery') or {}).get('message_ref')
    if not delivery:
        raise SystemExit('record the message that delivered this sheet first (record_answers.py delivered)')
    if payloads.message_id(ref) == payloads.message_id(delivery):
        raise SystemExit('his reply is a later message than the one that delivered the sheet')
    if payloads.message_id(ref) in stored_message_ids(a.sheet):
        raise SystemExit('message %s is already stored: a message is stored once' % ref)
    answers = validate_answers(ctx, sheet, common.load_json(a.answers))
    chk = transcript.check(sheet['sheet_sha256'], delivery, ref, {k: v['verbatim'] for k, v in answers.items()})
    if chk['problems'] and chk['checked']:
        raise SystemExit('transcript check: %s' % '; '.join(chk['problems']))
    message_at = message_time(a, ref, sheet)
    out = receipt_path(a.sheet, sheet, ref)
    receipt = {'sheet': os.path.abspath(a.sheet), 'sheet_sha256': sheet['sheet_sha256'],
               'sheet_run': sheet.get('sheet_run'), 'sheet_date': sheet['date'], 'message_ref': ref,
               'message_at': message_at, 'delivery_ref': delivery, 'answers_run': None, 'mode': a.mode,
               'transcript': 'checked' if chk['checked'] else 'not on this Mac',
               'readings': sum(1 for v in answers.values() if 'answer' in v),
               'rows': {k: {'sha256': common.sha256_text(v['verbatim']), 'answer': v.get('answer', UNREAD)}
                        for k, v in answers.items()}}
    if a.mode == common.DB:
        if not sheet.get('sheet_run'):
            raise SystemExit('the sheet has no review run: issue it with review_sheet.py --mode db first')
        rest = common.Rest()
        try:
            receipt['answers_run'] = rest.rpc('evidence_record_answers', payloads.record_answers(
                common.owner_id(a.user), sheet['sheet_run'], ref, answers, common.producer('record_answers.py'),
                common.code_version(), message_at))
        except common.RpcError as e:
            # (v9) reported, never retried: nothing was stored
            if e.code == '23505':
                raise SystemExit('the store already holds this message (a message is stored once): %s' % e.message)
            if e.code == '22023':
                raise SystemExit('the store refused the answers: %s' % e.message)
            raise
    common.dump_json(out, receipt)
    print('stored %d answers, %d with a reading (%s; message of %s; transcript %s; nothing decided: he confirms them in '
          'the app) -> %s' % (len(answers), receipt['readings'], receipt['answers_run'] or 'file mode', message_at,
                              receipt['transcript'], out))
    return 0


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
    read = {k: v for k, v in receipt['rows'].items() if not (v.get('answer') or {}).get('unread')}
    disputed = []
    for k, stored in sorted(read.items(), key=lambda x: int(x[0])):
        other = _norm_reading(second.get(k), ctx)
        if other != stored['answer']:
            disputed.append(k)
            manifest.mark_disputed({'answers_run': run, 'sheet_run': receipt.get('sheet_run'),
                                    'sheet': receipt['sheet'], 'row': int(k), 'by': 'second_reader',
                                    'first': stored['answer'], 'second': other})
    print('second reader: %d of %d stored readings agree (%d rows stored unread); disputed rows %s' % (
        len(read) - len(disputed), len(read), len(receipt['rows']) - len(read), disputed or 'none'))
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
                            'message_ref': payloads.norm_ref(a.message_ref)})
    print('answers run %s row %s marked disputed (his objection %s)' % (answers_run_of(receipt), a.row, a.message_ref))
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    for name in ('send', 'delivered', 'store', 'dispute'):
        s = sub.add_parser(name)
        s.add_argument('--sheet', required=True)
        s.add_argument('--case', required=True)
        s.add_argument('--mode', choices=[common.FILE, common.DB], default=common.FILE)
        s.add_argument('--user')
        if name != 'send':
            s.add_argument('--message-ref', required=True)
        if name == 'store':
            s.add_argument('--answers', required=True)
            s.add_argument('--message-at', help="(v9) the message's time as the chat shows it, when its transcript is "
                                                'not on this Mac')
        if name == 'dispute':
            s.add_argument('--receipt', required=True)
            s.add_argument('--row', required=True, type=int)
    sr = sub.add_parser('second-read')
    sr.add_argument('step', choices=['packet', 'compare'])
    sr.add_argument('--sheet', required=True)
    sr.add_argument('--case', required=True)
    sr.add_argument('--answers')
    sr.add_argument('--receipt')
    sr.add_argument('--second')
    sub.add_parser('decide', add_help=False)
    a, _rest = ap.parse_known_args()
    if a.cmd == 'decide':
        raise SystemExit('record_answers.py decide is retired (v8): no job decides; he confirms his stored answers '
                         'himself in the app (evidence_answers_to_confirm lists them)')
    a = ap.parse_args()
    ctx = common.Context(a.case, os.path.dirname(os.path.abspath(a.sheet)), mode=getattr(a, 'mode', common.FILE))
    payloads.use_contract(ctx.contract)
    if a.cmd == 'second-read':
        return second_packet(a, ctx) if a.step == 'packet' else second_compare(a, ctx)
    return {'send': send, 'delivered': delivered, 'store': store, 'dispute': dispute}[a.cmd](a, ctx)


if __name__ == '__main__':
    sys.exit(main())
