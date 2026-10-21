"""Deal documents (pass deal_document): anchored facts of a deal jacket or deal sheet, and the claims they state.

Each fact is one link with a mandatory anchor ('sale', 'acquired_date', 'line:labour'):
  a date the document states        role supports or contradicts (it backs or disputes a claim's date);
  a figure the document states      role assertion with direction, its amount at load time from the pinned document
                                    (@amount:<source>:<fact>), source_label = the document's own word for the line
                                    ('Labor', 'Paint'); never a pay characterisation (v3, RV2-6). With no payment
                                    joined it reads asserted_unpaid: listed, never summed.
The claims the documents state (acquisition, sale with trade_in_cents and the trade-in vehicle, the trade-in's own
acquisition with the ACV in asserted_value; v3 FM-8) are declared in the case with support selectors.
Facts are checked present in the pinned document before a link names them.
"""
import common
import money
import passlib
import payloads

PASSES = ['deal_document']


def build(ctx, built):
    cfg = ctx.pass_cfg('deal_document')
    if not cfg:
        return {}
    src = money.Sources(ctx)
    n, facts_missing = 0, []
    for d in cfg.get('documents') or []:
        veh = ctx.vid(d['vehicle'])
        sha = src.sha256(d['source']) if d.get('source') else None
        wanted = [a['amount_fact'] for a in d['anchors'] if a.get('amount_fact')]
        present = src.has_facts(d['source'], wanted) if wanted else {}
        for a in d['anchors']:
            if a.get('amount_fact') and not present.get(a['amount_fact']):
                facts_missing.append('%s#%s' % (d['external_ref'], a['anchor']))
                continue
            skey = payloads.source_key(external_ref=d['external_ref'], anchor=a['anchor'])
            row = payloads.evidence_link(
                veh, d.get('source_kind', 'deal_document'), a['role'], d.get('join_key', 'document names the vehicle'),
                a['confidence'], [dict(e) for e in d.get('evidence') or []] or [{'kind': 'document',
                                                                                  'ref': d['external_ref']}],
                external_ref=d['external_ref'], anchor=a['anchor'], source_sha256=sha,
                source_label=a.get('source_label'), occurred_on=a.get('occurred_on'), direction=a.get('direction'),
                amount_cents=payloads.amount_ref(d['source'], a['amount_fact']) if a.get('amount_fact') else None,
                cost_category=a.get('cost_category'), counterparty_label=a.get('counterparty_label'),
                summary=a.get('summary'))
            built.add('links.jsonl', payloads.line(payloads.link_key(skey, veh), 'propose_evidence_links',
                                                   'deal_document', row))
            n += 1
    if facts_missing:
        raise common.EvidenceError('deal_document: facts not found in the pinned document: %s' % facts_missing)
    nc = passlib.declared_claims(ctx, built, 'deal_document', cfg.get('claims'))
    return {'deal_document': {'emitted': n + nc, 'config': {
        'documents': [{'ref': d['external_ref'], 'anchors': [a['anchor'] for a in d['anchors']],
                       'sha256': src.sha256(d['source']) if d.get('source') else None} for d in cfg['documents']],
        'claims': [c.get('key') or c['kind'] for c in cfg.get('claims') or []]},
        'counts': {'links': n, 'claims': nc}}}


if __name__ == '__main__':
    passlib.pass_main(PASSES, __doc__)
