import re,html,json,sys,glob
out=[];summ={}
for n in range(40,81):
    s=open(f'r{n}.html',errors='ignore').read()
    cells=[html.unescape(c).replace('\xa0',' ').strip() for c in re.split(r'<[^>]+>',s)]
    cells=[c for c in cells if c]
    idx=[i for i in range(len(cells)-2) if cells[i]==str(n) and re.fullmatch(r'\d+(\.\d+)?[A-Z]?',cells[i+1]) and re.fullmatch(r'(18|19|20)\d\d(\.5)?',cells[i+2])]
    rows=[]
    for k,i in enumerate(idx):
        seg=cells[i:(idx[k+1] if k+1<len(idx) else i+12)]
        lot,yr=seg[1],seg[2]
        rest=seg[3:]
        money=[j for j,c in enumerate(rest) if re.fullmatch(r'\$\s?[\d,]+',c)]
        if not money: continue
        j=money[0]; words=rest[:j]
        price=int(re.sub(r'\D','',rest[j]))
        nosale=any('No Sale' in c for c in rest[j+1:j+3])
        make=words[0] if words else None; model=' '.join(words[1:]) if len(words)>1 else None
        rows.append(dict(auction_nbr=n,lot=lot,year=yr,make=make,model=model,price=price,status='no_sale' if nosale else 'sold',
            source_url=f'https://www.classic-carauction.com/auction-results?auctionnbr={n}'))
    # sale date from Auction-N page
    a=re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',open(f'a{n}.html',errors='ignore').read()))
    m=re.search(r'Auction (?:Results|#?\s?%d)(.{0,600})'%n,a)
    d=re.findall(r'((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\s*(?:[-–,&]|and|through|to)[^.]{0,30}?(?:20\d\d))',a)
    summ[n]=(len(rows),sum(r['status']=='sold' for r in rows),d[:2])
    out+=rows
json.dump(out,open('mcc_rows.json','w'))
for n,v in summ.items(): print(n,v)
print(len(out))
