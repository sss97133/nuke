import json,numpy as np
m=json.load(open('model_v2.json')); B={b['v']:b for b in json.load(open('bases.json'))}
R={r['v']:r for r in json.load(open('rows.json'))}
F=['fc','fo','fd','fr','fw','fi']; names=['f_condition','f_originality','f_documented_work','f_records','f_ownership','f_identity']
c=m['coef']; q=m['q']
def fee(h,d): return min(max(h*0.05,250),7500 if d>='2024-01-29' else 5000)
rows=[]
for v,b in B.items():
    r=R[v]; z=c['intercept']+sum(c[n]*float(r[k] or 0) for n,k in zip(names,F))
    mult=float(np.exp(z)); s=b['base']*mult; k=str(min(r['ns'] or 0,3)); lo=s*np.exp(q[k][0]); hi=s*np.exp(q[k][1])
    rows.append((v,b['d'],round(b['base'],2),mult,s,lo,hi,s+fee(s,b['d']),lo+fee(lo,b['d']),hi+fee(hi,b['d']),r['ns'] or 0,json.dumps({'n_comps':b['nc'],'platforms':b['pls']})))
hdr="insert into nuke_estimates_shadow (vehicle_id, model_version, as_of, base_value, base_comp_method, evidence_multiplier, shadow_value, shadow_low, shadow_high, shadow_gross, shadow_gross_low, shadow_gross_high, shadow_net_to_owner, price_basis, n_sources, citations, run_id) values\n"
for i in range(0,len(rows),2000):
    vals=",\n".join(f"('{v}','shadow-v2-hammer-pit',('{d}'::date+1)::timestamptz,{b},'pit_hammer_median_40',{mu:.6f},{s:.2f},{lo:.2f},{hi:.2f},{g:.2f},{gl:.2f},{gh:.2f},{s:.2f},'hammer',{ns},'{cj}'::jsonb,'7e1d0c24-2026-4a10-9e00-0000000a5003')" for v,d,b,mu,s,lo,hi,g,gl,gh,ns,cj in rows[i:i+2000])
    open(f'ins_{i//2000:02d}.sql','w').write(hdr+vals+"\non conflict (vehicle_id, model_version) do nothing;")
print(len(rows))
