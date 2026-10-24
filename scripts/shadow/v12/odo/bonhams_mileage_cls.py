import json,re,sys
CTX=re.compile(r'\b(odometer|odo|mileage|indicat\w*|recorded|showing|shows|displays?|reads?|reading|covered|from new|since new|total|genuine|actual|original|documented|warranted|believed|on the clock|speedometer|displaying|only|kilom[eé]trage|compteur|tachostand|laufleistung)\b',re.I)
def cls(r):
    m=r['m']; sn=r['sn']
    if r['len']<20000: return 'unverified','page_unavailable',''
    if not sn: return 'suspect','not_on_page',''
    best=None
    for s in sn:
        k=re.search(r'(?<![\d,.])'+'{:,}'.format(m).replace(',',r'[,.\s]?')+r'(?!\d)',s)
        if not k: continue
        aft=re.sub(r'^\s*(original|indicated|recorded|actual|genuine|documented|believed|warranted|total)\s+',' ',s[k.end():k.end()+40].lower()); bef=s[:k.start()][-70:].lower()
        if re.match(r'\s*(/?\s*km\s*/\s*h|kmh|kph|km/hr|mph|kilomet\w+ per hour|miles per hour|km par heure)',aft): t=('suspect','speed')
        elif re.match(r'\s*(mpg|miles? per gallon|miles? to the gallon|l/100)',aft): t=('suspect','mpg')
        elif re.match(r'\s*(miles?|km|kilomet\w+)\s+(in|per)\s+(an?|one)\s+hour',aft): t=('suspect','distance_per_hour')
        elif re.match(r'\s*(miles?|km|kilomet\w+)\s+(to (every|the|a) (gallon|litre)|on a (gallon|tank))',aft): t=('suspect','mpg')
        elif re.match(r'\s*(miles?|km|kilomet\w+)\s+(per|a|each)\s+(year|annum|month|day)',aft): t=('suspect','annual_rate')
        elif re.match(r'\s*(miles?|km|kilomet\w+)\s+(in\s+\d|in less than|at\s+[A-Z]|ago)',s[k.end():k.end()+30]): t=('suspect','event_distance')
        elif re.match(r'\s*(miles?|mi\b|km|kms|kilom\w+)',aft) and re.search(r'\bsince\s+(its|a|an|the|his|her|their|complet|rebuild|restor|overhaul)',aft): t=('unverified','since_event')
        elif re.match(r'\s*(miles?|mi\b|km|kms|kilom\w+)',aft) and CTX.search(bef+' '+aft): t=('verified','odometer_context')
        elif re.match(r'\s*(miles?|mi\b|km|kms|kilom\w+)',aft): t=('unverified','unit_no_odometer_context')
        else: t=('suspect','not_on_page_as_mileage')
        rank={'verified':0,'unverified':1,'suspect':2}[t[0]]
        if best is None or rank<best[0]: best=(rank,t,s)
    if best is None: return 'suspect','not_on_page',''
    return best[1][0],best[1][1],best[2]
if __name__=='__main__':
    import collections;C=collections.Counter()
    for l in open(sys.argv[1]):
        r=json.loads(l); st,re_,s=cls(r); C[(st,re_)]+=1
        if len(sys.argv)>2: print(st,re_,r['m'],'|',s[:170])
    print(C)
