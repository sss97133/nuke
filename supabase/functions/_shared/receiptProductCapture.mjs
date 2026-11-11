// Shared deterministic receipt -> supplier query -> primary product parser.
// Catalog testimony is separate from purchase, installation and payment.
export const normalizePart = value => String(value ?? '').trim().replace(/^\*+/, '').toUpperCase();
// O'Reilly prints its product-line code beside the receipt description. A part
// number alone is not unique across its brands (e.g. hose clamps and exhaust).
export const receiptLineCode = description => String(description ?? '').match(/\(([A-Z0-9]{2,3})(?=[,)])/i)?.[1].toUpperCase() ?? null;
export function supplierKey(vendor) {
  if (/^classic industries$/i.test(String(vendor).trim())) return 'classic_industries';
  if (/^o['’]?reilly auto parts(?:\s*\(store \d+\))?$/i.test(String(vendor).trim())) return 'oreilly';
  if (/^ames performance$/i.test(String(vendor).trim())) return 'ames';
  return null;
}
export function lineRole(line) {
  const d = String(line.description ?? '');
  if (/core (charge|return|exchange)/i.test(d)) return 'core';
  if (/freight|shipping|handling/i.test(d)) return 'shipping';
  if (/return/i.test(d)) return 'return';
  if (/shipped 0|back.?order/i.test(d)) return 'unfulfilled_order';
  return 'purchase_record';
}
export function productEligible(line) {
  const pn = normalizePart(line.part_number);
  return pn.length > 0 && pn.length <= 100 && !['core','shipping'].includes(lineRole(line)) && !/[{}]/.test(pn);
}
export function supplierCandidates(vendor, part) {
  const key = supplierKey(vendor), pn = normalizePart(part), encoded = encodeURIComponent(pn.toLowerCase());
  if (key === 'classic_industries') return [
    {url:`https://www.classicindustries.com/product/${encoded}.html`,role:'original_receipt_supplier',kind:'product'},
    {url:`https://www.oerparts.com/product/${encoded}.html`,role:'catalog_cross_reference',kind:'product'},
  ];
  if (key === 'oreilly') return [{url:`https://www.oreillyauto.com/search?q=${encodeURIComponent(pn)}`,role:'original_receipt_supplier',kind:'search'}];
  return [];
}
export const allowedProductUrl = url => {
  try {const u = new URL(url);return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
    ['www.classicindustries.com','classicindustries.com','www.oerparts.com','oerparts.com','www.oreillyauto.com','oreillyauto.com'].includes(u.hostname);} catch{return false;}
};
const decode = s => String(s ?? '').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,c)=>{const n=c[0].toLowerCase()==='x'?parseInt(c.slice(1),16):parseInt(c,10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}).replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const clean = s => decode(String(s ?? '').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
function attrs(tag) {const out={};for(const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))out[m[1].toLowerCase()]=decode(m[2]??m[3]);return out;}
function jsonProducts(value, out=[]) {
  if(Array.isArray(value))for(const v of value)jsonProducts(v,out);
  else if(value&&typeof value==='object'){if([value['@type']].flat().includes('Product'))out.push(value);if(value['@graph'])jsonProducts(value['@graph'],out);}
  return out;
}
export function parseProductPage(html, url, expectedPart) {
  const metas=[...html.matchAll(/<meta\b[^>]*>/gi)].map(m=>attrs(m[0]));
  const meta=(key,value)=>metas.find(m=>m[key]===value)?.content;
  const products=[];
  for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try{jsonProducts(JSON.parse(m[1]),products)}catch{}
  // Only the primary product; never promote a matching recommendation/search card.
  const product=products[0];
  const scopes = [...html.matchAll(/<[a-z][\w:-]*\b[^>]*itemtype=["']https?:\/\/schema.org\/Product["'][^>]*>/gi)];
  const primaryScope = scopes.length ? html.slice(scopes[0].index, scopes[1]?.index ?? html.length) : '';
  const primaryMetas = [...primaryScope.matchAll(/<meta\b[^>]*>/gi)].map(m => attrs(m[0]));
  const primaryMeta = value => primaryMetas.find(m => m.itemprop === value)?.content;
  const identifiers = product ? [product.sku, product.mpn] : [primaryMeta('sku'), primaryMeta('mpn')];
  const rawSku = identifiers.find(value => value != null && normalizePart(value) === normalizePart(expectedPart));
  if(rawSku == null)return {status:'sku_not_verified'};
  const offers=Array.isArray(product?.offers)?product.offers[0]:product?.offers;
  const rawPrice=offers?.price??primaryMeta('price');
  const image=[product?.image].flat()[0]??meta('property','og:image');
  const rawImage=typeof image==='object'?image?.url:image;
  const itemName=html.match(/<div[^>]*itemtype=["']https?:\/\/schema.org\/Product["'][^>]*>\s*<meta[^>]*itemprop=["']name["'][^>]*>/i);
  const name=product?.name||(itemName?attrs(itemName[0].slice(itemName[0].lastIndexOf('<meta'))).content:null)||clean(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  let imageUrl=null;try{if(rawImage)imageUrl=new URL(rawImage,url).href}catch{}
  if(!name||!imageUrl||!/^https:\/\//.test(imageUrl)||/logo|placeholder|no[-_]?image|image[-_]?coming/i.test(imageUrl))return {status:'exact_sku_without_product_image'};
  const brandBlock=html.match(/<div[^>]*itemprop=["']brand["'][^>]*>[\s\S]*?<meta[^>]*itemprop=["']name["'][^>]*>/i);
  const brand=typeof product?.brand==='string'?product.brand:product?.brand?.name;
  const description=product?.description||html.match(/id=["']product-description-content["'][^>]*>([\s\S]*?)(?=<div[^>]+id=["']product-specs-content|<div[^>]+id=["']product-reviews-content)/i)?.[1];
  return {status:'exact_sku_page',printed_sku:String(rawSku),product_name:clean(name),
    manufacturer:brand||(brandBlock?attrs(brandBlock[0].slice(brandBlock[0].lastIndexOf('<meta'))).content:null),
    image_url:imageUrl,price:rawPrice!=null&&/^\d+(\.\d+)?$/.test(String(rawPrice))?Number(rawPrice):null,
    currency:offers?.priceCurrency??primaryMeta('priceCurrency')??null,
    availability:offers?.availability??null,description:clean(description).slice(0,12000),
    price_basis:'supplier_page_offer_not_receipt_cost',match_basis:'exact_primary_catalog_sku; installation_not_asserted'};
}
/** @param {string | null} lineCode */
export function productLinks(html, searchUrl, part, lineCode = null) {
  const result=[];for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)){
    let url;try{url=new URL(decode(m[1]),searchUrl)}catch{continue}
    if(url.hostname!==new URL(searchUrl).hostname||!allowedProductUrl(url.href)||!url.pathname.startsWith('/detail/c/'))continue;
    let segments;try{segments=url.pathname.split('/').map(decodeURIComponent)}catch{continue;}
    if(normalizePart(segments.at(-1))!==normalizePart(part))continue;
    if(lineCode && segments.at(-2)?.toUpperCase()!==lineCode.toUpperCase()+'0')continue;
    url.hash='';if(!result.some(existing => new URL(existing).pathname===url.pathname))result.push(url.href);
  }return result.slice(0,3);
}
