"""Identity (pass identity_compare): same_vehicle_as claims between two profiles of one truck.

Each claim names the survivor (survivor_vehicle_id: the row nuke-04 keeps; PLAN section 1 ask 1). A proposed pair
blocks pins and filings on both rows (promote_image -> identity_open) until the owner answers; a confirmed pair joins
the identity set the readers union (one hop), and merging stays nuke-04's. Claims are declared in the case with
support selectors (an album that maps to both rows, the VIN, the series).
"""
import passlib

PASSES = ['identity_compare']


def build(ctx, built):
    cfg = ctx.pass_cfg('identity_compare')
    if not cfg:
        return {}
    specs = []
    for c in cfg.get('claims') or []:
        specs.append(dict(c, kind='same_vehicle_as', domain=c.get('domain', 'record')))
    n = passlib.declared_claims(ctx, built, 'identity_compare', specs)
    return {'identity_compare': {'emitted': n, 'config': {
        'pairs': [[ctx.vid(c['vehicle']), ctx.vid(c['related_vehicle']), ctx.vid(c.get('survivor_vehicle'))]
                  for c in cfg.get('claims') or []]},
        'counts': {'claims': n}}}


if __name__ == '__main__':
    passlib.pass_main(PASSES, __doc__)
