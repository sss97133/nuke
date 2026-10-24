import json,re
r=json.load(open('defs.json'))
NAMES=['get_comps_scored','get_auction_comps','get_comps_combined','find_bat_comps','compute_nuke_estimates_bulk','compute_shadow_comp_base','get_comp_tiers','compute_vehicle_value']
SUB="(select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item')"
out=[];old=[]
pat=re.compile(r"(?i)\b(FROM|JOIN)\s+(public\.)?vehicles\b(?!\s*\()(\s+(?:AS\s+)?(?!WHERE|ON|JOIN|LEFT|INNER|GROUP|ORDER|LIMIT|USING|WINDOW|CROSS|UNION|SET)([a-z_][a-z0-9_]*))?")
for x in r:
    if x['sig'].startswith('VIEW'): continue
    d=x['def']; n=0
    def rep(m):
        global n
        alias=m.group(4) or 'vehicles'
        return f"{m.group(1)} {SUB} {alias}"
    nd,n=pat.subn(rep,d)
    print(x['sig'],n)
    for m in pat.finditer(d): print('   ',repr(m.group(0)))
    old.append(d); out.append(nd)
open('wrap_apply.sql','w').write('\n;\n'.join(out)+'\n;\n')
open('wrap_revert.sql','w').write('\n;\n'.join(old)+'\n;\n')
