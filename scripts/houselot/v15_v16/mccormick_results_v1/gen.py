import json,re
rows=json.load(open('mcc_rows.json'))
txt={47:'November 26-28, 2009',48:'February 26-28, 2010',49:'November 26-28, 2010',50:'February 25 - 27, 2011',51:'November 18-20, 2011',52:'February 24-26, 2012',53:'November 16-18, 2012',54:'November 22nd, 23rd & 24th 2013',56:'February 21st, 22nd & 23rd 2014',57:'November 21st - 23rd 2014',58:'February 20th, 21st & 22nd 2015',59:'November 20th, 21st & 22nd 2015',64:'February 23rd, 24th & 25th 2018',66:'February 22nd, 23rd and 24th, 2019',67:'November 22 - 24, 2019',68:'February 21st, 22nd and 23rd, 2020',69:'November 20th, 21st and 22nd, 2020'}
def month(n):
    return (f"{2009+(n-47)//2}-11-01") if n%2 else (f"{2010+(n-48)//2}-02-01")
q=lambda v:'null' if v is None else "'"+str(v).replace("'","''")+"'"
ddl="""create table if not exists public.mccormick_results_stage_v1_20261024(
 id bigserial primary key, run_id text not null default 'mccormick_results_v1_20261024', auction_nbr int not null, sale_month date not null,
 sale_dates_text text, sale_dates_source_url text, lot_number text not null, year text, make text, model text, price_usd numeric, status text not null,
 price_note text not null default 'McCormick results pages: sold prices include buyer fee (5-6%); no_sale price is high bid',
 source_url text not null, fetched_at timestamptz not null default now(), unique(auction_nbr,lot_number,make,model,price_usd));
comment on table public.mccormick_results_stage_v1_20261024 is 'Staging only (no vehicles): McCormick Palm Springs results, cited per row; revert = drop table.';
"""
open('ddl.sql','w').write(ddl)
B=2500
for b in range(0,len(rows),B):
    vals=[]
    for r in rows[b:b+B]:
        n=r['auction_nbr']; t=txt.get(n)
        vals.append(f"({n},'{month(n)}',{q(t)},{q('https://www.classic-carauction.com/Auction-%d'%n if t else None)},{q(r['lot'])},{q(r['year'])},{q(r['make'])},{q(r['model'])},{r['price']},'{r['status']}',{q(r['source_url'])})")
    open(f'ins{b//B}.sql','w').write("insert into public.mccormick_results_stage_v1_20261024(auction_nbr,sale_month,sale_dates_text,sale_dates_source_url,lot_number,year,make,model,price_usd,status,source_url) values\n"+",\n".join(vals)+"\non conflict do nothing;")
print(len(rows), (len(rows)+B-1)//B)
