"""Account map (pass account_map): which account or Nuke organization is whose, as proposals the owner confirms.

entity_key says who a party is (owner, owner_business:<label>, third_party:<role>, unknown), never what money was
for (OWNER-DECISIONS 4/5). Account refs are labels ('bank_account:<series>'), never account numbers. Until the owner
confirms a row, every link from or to that account reads account_entity_unknown and payer/payee 'unknown'; once
confirmed, the readers resolve the side of every link whose payer/payee is NULL from it (v3, FM-7). A nuke_org ref
carries the organization's full uuid (scope reads it).
"""
import passlib
import payloads

PASSES = ['account_map']


def build(ctx, built):
    cfg = ctx.pass_cfg('account_map')
    if not cfg:
        return {}
    n = 0
    for a in cfg.get('accounts') or []:
        built.add('account_entities.jsonl', payloads.line(
            'entity:' + a['account_ref'], 'propose_account_entities', 'account_map',
            payloads.account_entity(a['account_ref'], a['entity_key'], a['confidence'], a['evidence'])))
        n += 1
    return {'account_map': {'emitted': n, 'config': {'accounts': [a['account_ref'] for a in cfg['accounts']]},
                            'counts': {'entities': n}}}


if __name__ == '__main__':
    passlib.pass_main(PASSES, __doc__)
