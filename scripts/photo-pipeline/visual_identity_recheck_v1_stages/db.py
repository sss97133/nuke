import os,json,urllib.request
URL='https://qkgaybvrernstplzjaam.supabase.co';K=os.environ['SUPABASE_SECRET_KEY']
H={'apikey':K,'Authorization':'Bearer '+K,'Content-Type':'application/json'}
def req(m,p,b=None,extra=None,timeout=180):
    r=urllib.request.Request(URL+p,data=None if b is None else json.dumps(b).encode(),headers={**H,**(extra or {})},method=m)
    with urllib.request.urlopen(r,timeout=timeout) as x: t=x.read(); return json.loads(t) if t else None
def rpc(fn,args,**kw): return req('POST','/rest/v1/rpc/'+fn,args,**kw)
