"""Gmail passes: gmail_order (order threads) and listing_watch (listing emails, listing pages, listing claims).

Ids and joins only. The repo has no Gmail API client: its mail paths are Apple Mail's local cache
(scripts/ingest-mail-alerts.py) and private raw-email manifests. This pass reads a private manifest (case input
gmail_manifest) that a session writes with the Gmail connector: thread ids, dates, the vendor or sender, and for an
order the ledger line its total and date join (never the total itself; files carry no amounts). collect_from_mail()
is the documented stub for collecting the same manifest unattended.

gmail_order    joined to exactly one ledger line: role payment_out with payment_key 'bank:<line id>', the line's
               amount at load time and payment_join_confidence (how sure the source is this payment; v3, FM-4);
               otherwise role assertion with no amount and no payment_key (listed under asserted_unpaid, never
               summed; v3, FM-5).
listing_watch  listing-event emails (source_kind gmail_message) and listing pages (listing) as supports links, and
               one listing claim per listing window (v3, FM-11/FM-13).
"""
import common
import payloads
import passlib

PASSES = ['gmail_order', 'listing_watch']


def collect_from_mail(*_a, **_k):
    """Unattended collection is not built: no Gmail API client exists in the repo, and an OAuth client is a
    credential (the owner's call). Until then a session with the Gmail connector writes the manifest: for each order
    thread its id, date, vendor and the ledger line whose total and date it matches (or why none does)."""
    raise NotImplementedError(collect_from_mail.__doc__)


def build(ctx, built):
    p = ctx.input_path('gmail_manifest')
    if not p:
        return {}
    man = common.load_json(p)
    cfg = ctx.pass_cfg('gmail_order')
    lsrc = cfg.get('ledger_source')
    account = cfg.get('account_ref')
    no, nl, nc = 0, 0, 0
    joined, unjoined = 0, 0
    for t in man.get('threads') or []:
        veh = ctx.vid(t['vehicle'])
        ext = 'gmail:thread:' + t['thread_id']
        key = payloads.link_key(ext, veh)
        if t['kind'] == 'order':
            pj = t.get('payment_join')
            ev = [{'kind': 'gmail', 'ref': 'thread:' + t['thread_id']}]
            if pj:
                ev.append({'kind': 'ledger', 'ref': pj['line_id'], 'join_basis': pj.get('basis')})
                row = payloads.evidence_link(
                    veh, 'gmail_order', 'payment_out', t.get('join_key', 'order total and date = one ledger line'),
                    t['confidence'], ev, external_ref=ext, source_label=t.get('source_label'), occurred_on=t['date'],
                    amount_cents=payloads.amount_ref(lsrc, pj['line_id']), cost_category=t.get('cost_category'),
                    counterparty_label=t.get('counterparty_label'), payment_key='bank:' + pj['line_id'],
                    payee_entity=t.get('payee_entity'), from_account_ref=account,
                    payment_join_confidence=pj.get('confidence', 0.9), summary=t.get('summary'))
                joined += 1
            else:
                if t.get('why_unjoined'):
                    ev.append({'kind': 'note', 'ref': t['why_unjoined']})
                row = payloads.evidence_link(
                    veh, 'gmail_order', 'assertion', t.get('join_key', 'order number; no payment joined'),
                    t['confidence'], ev, external_ref=ext, source_label=t.get('source_label'), occurred_on=t['date'],
                    direction='out', cost_category=t.get('cost_category'),
                    counterparty_label=t.get('counterparty_label'), payee_entity=t.get('payee_entity'),
                    summary=t.get('summary'))
                unjoined += 1
            built.add('links.jsonl', payloads.line(key, 'propose_evidence_links', 'gmail_order', row))
            no += 1
        elif t['kind'] == 'listing_event':
            built.add('links.jsonl', payloads.line(key, 'propose_evidence_links', 'listing_watch', payloads.evidence_link(
                veh, 'gmail_message', 'supports', t.get('join_key', 'listing title'), t['confidence'],
                [{'kind': 'gmail', 'ref': 'thread:' + t['thread_id'], 'sender': t.get('sender')}], external_ref=ext,
                occurred_on=t['date'], summary=t.get('summary'))))
            nl += 1
        else:
            raise common.EvidenceError('gmail manifest: unknown thread kind %s' % t['kind'])
    for ls in man.get('listings') or []:
        veh = ctx.vid(ls['vehicle'])
        ext = 'listing:' + ls['ref']
        lkey = payloads.link_key(ext, veh)
        built.add('links.jsonl', payloads.line(lkey, 'propose_evidence_links', 'listing_watch', payloads.evidence_link(
            veh, 'listing', 'supports', ls.get('join_key', 'listing slug'), ls['confidence'],
            ls.get('evidence') or [{'kind': 'listing', 'ref': ls['ref']}], external_ref=ext, occurred_on=ls['date'],
            summary=ls.get('summary'))))
        nl += 1
        c = ls.get('claim')
        if c:
            sup = []
            if c.get('date_thread'):
                sup.append({'link': {'source_key': 'gmail:thread:' + c['date_thread'], 'vehicle': ls['vehicle']},
                            'stance': 'supports', 'about': 'date'})
            sup.append({'link': {'source_key': ext, 'vehicle': ls['vehicle']}, 'stance': 'supports', 'about': 'vehicle'})
            ck = passlib.claim_key(built, 'listing', veh, c.get('key'))
            built.add('change_claims.jsonl', payloads.claim_line(ck, 'listing_watch', payloads.change_claim(
                veh, 'custody', 'listing', c['summary'], c['confidence'], occurred_from=c['from'],
                occurred_to=c['to']), passlib.select_supports(ctx, built, sup)))
            nc += 1
    return {
        'gmail_order': {'emitted': no, 'config': {
            'join_rule': 'payment_key only when the order total and date join one ledger line',
            'unjoined': 'assertion with no amount (listed under asserted_unpaid)',
            'manifest': 'private, written by a session with the Gmail connector; ids and joins only'},
            'counts': {'orders': no, 'joined': joined, 'unjoined': unjoined}},
        'listing_watch': {'emitted': nl + nc, 'config': {
            'sources': 'listing-event emails and listing pages; listing claims per listing window'},
            'counts': {'links': nl, 'claims': nc}}}


if __name__ == '__main__':
    passlib.pass_main(PASSES, __doc__)
