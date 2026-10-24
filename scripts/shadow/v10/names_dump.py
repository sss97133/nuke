import pickle,collections,json,resource
G,V,VA=pickle.load(open('comps_v9.pkl','rb'))
C=collections.Counter()
for (mk,md),L in G[0].items():
  for x in L: C[(x[4],mk,md)]+=1
json.dump([[a,b,c,n] for (a,b,c),n in C.items()],open('../v10/names.json','w'))
json.dump({v:list(t) for v,t in V.items()},open('../v10/V.json','w'))
json.dump({v:[None if a[0]!=a[0] else a[0],a[1]] for v,a in VA.items()},open('../v10/VA.json','w'))
print(len(C),resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024)
