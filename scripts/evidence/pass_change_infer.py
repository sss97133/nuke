"""Change inference (pass change_infer): claims inferred from other evidence already built this run.

Physical work claims (paint, body, engine, ...) dated by the photos that show it, and `work_performed` claims for
labour by others: who did the work (party_entity 'third_party:<role>' or 'owner') and on which days, supported by the
payment links and the photos, with no pay characterisation (v3, ET2-7 d). A claim may take its window from its
photo supports ("window_from_support": true). Declared in the case with support selectors.
"""
import passlib

PASSES = ['change_infer']


def build(ctx, built):
    cfg = ctx.pass_cfg('change_infer')
    if not cfg:
        return {}
    n = passlib.declared_claims(ctx, built, 'change_infer', cfg.get('claims'))
    return {'change_infer': {'emitted': n, 'config': {
        'claims': [c.get('key') or c['kind'] for c in cfg.get('claims') or []],
        'rule': 'claims inferred from photos and links built this run; window from the dated photo supports'},
        'counts': {'claims': n}}}


if __name__ == '__main__':
    passlib.pass_main(PASSES, __doc__)
