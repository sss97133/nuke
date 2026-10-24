import json,math,sys
tag,rf,mf,run=sys.argv[1:5]
R=json.load(open(rf)); M=json.load(open(mf))
meth={0:'pit_hammer_median_40',1:'pit_hammer_median_40_model_family',2:'pit_hammer_median_40_make_decade'}; conf={0:'high',1:'medium',2:'low'}
fee=lambda h,d: min(max(h*0.05,250),7500 if d>='2024-01-29' else 5000)
hdr="insert into nuke_estimates_shadow (vehicle_id, model_version, as_of, base_value, base_comp_method, evidence_multiplier, shadow_value, shadow_low, shadow_high, shadow_gross, shadow_gross_low, shadow_gross_high, shadow_net_to_owner, price_basis, n_sources, citations, run_id) values\n"
for i in range(0,len(R),5000):
  vals=",\n".join(f"('{r['v']}','{tag}',('{r['d']}'::date+1)::timestamptz,{r['base']:.2f},'{meth[r['lv']]}',{math.exp(r['a']):.6f},{r['s']:.2f},{r['lo']:.2f},{r['hi']:.2f},{r['s']+fee(r['s'],r['d']):.2f},{r['lo']+fee(r['lo'],r['d']):.2f},{r['hi']+fee(r['hi'],r['d']):.2f},{r['s']:.2f},'hammer',0,'{json.dumps(dict(level=r['lv'],n_comps=r['nc'],confidence=conf[r['lv']],w_comps=r['w'],w_live=round(1-r['w'],2),extract='snap_v7_firstclass_hammer_usd_dated'))}'::jsonb,'{run}')" for r in R[i:i+5000])
  open(f'{tag}_ins_{i//5000:02d}.sql','w').write(hdr+vals+"\non conflict (vehicle_id, model_version) do nothing;")
print(tag,len(R))
