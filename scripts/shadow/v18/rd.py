import json,re
def rd(path):
    t=open(path).read()
    try: t=json.loads(t)["result"]
    except Exception: pass
    m=re.search(r'>\s*(\[.*\])\s*</untrusted',t,re.S)
    return json.loads(m.group(1))
