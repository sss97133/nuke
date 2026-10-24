import numpy as np,json,math
S=np.load('sets_v10.npz'); M=np.load('meta_v10.npz'); P=dict(np.load('pred_v10.npz')); M=dict(M)
lv=S['lv']; Z=S['Zall']; Nn=S['Nall']; run='7e1d0c24-2026-4a10-9e00-0000000a5021'; tag='shadow-v10-pit-gbm'
meth={0:'pit_simadj_gbm_model',1:'pit_simadj_gbm_family',2:'pit_simadj_gbm_make_decade'}; conf={0:'high',1:'medium',2:'low'}
fee=lambda h,d: min(max(h*0.05,250),7500 if d>='2024-01-29' else 5000)
R=[]
for i in range(len(lv)):
  L=int(lv[i]); s=float(P['s'][i])
  if L>2 or not math.isfinite(s) or not math.isfinite(Z[i,L]): continue
  R.append((M['v'][i],str(M['d'][i]),L,int(Nn[i,L]),math.exp(Z[i,L]),s,float(P['lo'][i]),float(P['hi'][i])))
hdr="insert into nuke_estimates_shadow (vehicle_id, model_version, as_of, base_value, base_comp_method, evidence_multiplier, shadow_value, shadow_low, shadow_high, shadow_gross, shadow_gross_low, shadow_gross_high, shadow_net_to_owner, price_basis, n_sources, citations, run_id) values\n"
for k in range(0,len(R),5000):
  vals=",\n".join(f"('{v}','{tag}','{d}'::date::timestamptz,{b:.2f},'{meth[L]}',{s/b:.6f},{s:.2f},{lo:.2f},{hi:.2f},{s+fee(s,d):.2f},{lo+fee(lo,d):.2f},{hi+fee(hi,d):.2f},{s:.2f},'hammer',0,'{json.dumps(dict(level=L,n_comps=n,confidence=conf[L],pit='comps sold strictly before as_of',live_input=False,extract='snap_v8_hammer_usd_dated',mileage='auction_event_listing_mileage (PIT)',model_norm='model_name_normalization run a5021',segment_map='model_segment_map run a5021'))}'::jsonb,'{run}')" for v,d,L,n,b,s,lo,hi in R[k:k+5000])
  open(f'ins_{k//5000:02d}.sql','w').write(hdr+vals+"\non conflict (vehicle_id, model_version) do nothing;")
print(len(R))
