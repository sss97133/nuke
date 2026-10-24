import sys
sys.argv=['x','4']
src=open('run4.py').read().split('for g in')[0]
exec(src); BC[4]=dict(k=300,w=1,ta=5,ty=3,tm=1e9,yw=9,g=4)
D={}; MF_={}
for k in [0,1,2,3,'all']:
  tr=~te&(f4!=k) if k!='all' else ~te
  Z,Nn=sets(tr); MF_[k]=np.c_[tuple(CMF[s].copy() for s in range(NS))].astype(np.float32); D[k]=(np.c_[tuple(Z[s] for s in range(NS))].astype(np.float32),np.c_[tuple(Nn[s] for s in range(NS))].astype(np.int32))
  print(k,flush=True)
np.savez('sets_v11.npz',**{f'M{k}':MF_[k] for k in MF_},TMU=TMU,TMISS=TMISS,**{f'Z{k}':D[k][0] for k in D},**{f'N{k}':D[k][1] for k in D},lp=lp,p=p,e=e,lo=lo,hi=hi,lv=lv,f5=f5,f4=f4,TM=TM,yr=np.array([0]))
json.dump(BC,open('cfg_v11.json','w'))
