#!/usr/bin/env node
// Rank archived eBay Motors item URLs from retained Wayback CDX pages by the title in the URL alone: no page is fetched.
// Input: a directory of CDX text pages ("<timestamp> <original> <status> <mime>" per line), as walked page by page from
// https://web.archive.org/cdx/search/cdx?url=cgi.ebay.com/ebaymotors/*&collapse=urlkey&page=N.
// Output: JSONL, one line per eBay item id, best score first: {item_id, score, year, title, reasons, captures:[{timestamp, original}]}.
//
//   node scripts/ebay-wayback/discover.mjs <cdx dir> <out.jsonl> [--min-score 3] [--max-year 1995]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, out] = process.argv.slice(2);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const minScore = arg('--min-score', 3), maxYear = arg('--max-year', 1995);
if (!dir || !out) { console.error('usage: discover.mjs <cdx dir> <out.jsonl> [--min-score N] [--max-year YYYY]'); process.exit(2); }

const MAKES = ['AC', 'Alfa', 'AMC', 'Aston', 'Auburn', 'Austin', 'Bentley', 'BMW', 'Bizzarrini', 'Buick', 'Cadillac', 'Checker', 'Chevrolet', 'Chevy',
  'Chrysler', 'Citroen', 'Cord', 'Datsun', 'DeLorean', 'DeSoto', 'De-Tomaso', 'Detomaso', 'Dodge', 'Duesenberg', 'Edsel', 'Facel', 'Ferrari', 'Fiat', 'Ford',
  'GMC', 'Hudson', 'Iso', 'International', 'Jaguar', 'Jeep', 'Jensen', 'Lamborghini', 'Lancia', 'Land-Rover', 'Lincoln', 'Lotus', 'Maserati', 'Mercedes',
  'Mercedes-Benz', 'Mercury', 'MG', 'Mopar', 'Morgan', 'Nash', 'Oldsmobile', 'Packard', 'Plymouth', 'Pontiac', 'Porsche', 'Rambler', 'Rolls', 'Rolls-Royce',
  'Shelby', 'Studebaker', 'Sunbeam', 'Toyota', 'Triumph', 'Tucker', 'Volkswagen', 'VW', 'Volvo', 'Willys', 'Nissan', 'Honda', 'Mazda', 'Saab', 'Lexus',
  'Acura', 'Alpine', 'Avanti', 'Bugatti', 'Delahaye', 'Hispano', 'Kaiser', 'Pierce', 'Stutz', 'Talbot', 'Excalibur', 'Pantera', 'Corvette', 'Mustang', 'Bronco', 'Scout'];
const MAKE_RE = new RegExp(`^(${MAKES.join('|')})$`, 'i');
// A part, accessory or collectible titled with a car's year and make (the bulk of ebaymotors URLs).
const PARTS = /\b(emblem|badge|manual|brochure|decal|sticker|ornament|radiator|gauge|carb|carburetor|hubcap|hub-cap|wheel-cover|rims?|tires?|grille|bumper|fender|hood|door-panel|seat-cover|mirror|tail-?light|head-?light|lens|bezel|trim-piece|molding|moulding|gasket|piston|camshaft|crank|distributor|alternator|starter|solenoid|pump|filter|sensor|switch|relay|wiring|harness|cable|bracket|mount|bolt|clip|kit|model-kit|diecast|die-cast|scale|1-18|1-24|1-43|toy|poster|sign|keychain|key-chain|license-plate|plate|book|magazine|shop-manual|parts|core|exhaust|header|intake|manifold|transmission-only|engine-only|block|heads|axle|rearend|rear-end|spring|shock|strut|steering-wheel|knob|dash|pad|carpet|console|cover|tarp|jack|tool)\b/i;
const COOL = [
  [/barn-?find/i, 3, 'barn find'], [/survivor/i, 3, 'survivor'], [/unrestored/i, 2, 'unrestored'], [/(numbers|#s)-?matching|matching-?numbers/i, 3, 'numbers matching'],
  [/one-?owner|1-owner/i, 2, 'one owner'], [/original-?(paint|owner|miles)/i, 2, 'original'], [/low-?miles|\d{1,2}-?\d{3}-?(original-?)?miles/i, 1, 'miles stated'],
  [/concours|frame-?off|rotisserie|nut-?(and|&)-?bolt/i, 2, 'restoration grade'], [/documented|marti|protect-?o-?plate|build-?sheet|window-?sticker/i, 2, 'documented'],
  [/\b(hemi|boss|shelby|yenko|copo|judge|z-?28|ls6|l88|l71|427|428|440|454|ram-?air|six-?pack|gt500|gt350|cobra|mach-?1|superbird|daytona|gsx|w-?30|442|ss-?396|ss-?454|baldwin|motion|dana)\b/i, 3, 'performance option'],
  [/\b(ferrari|lamborghini|maserati|aston|bizzarrini|iso|facel|de-?tomaso|pantera|ac-?cobra|ac-?aceca|lancia|bugatti|duesenberg|delahaye|tucker|300-?sl|gullwing|e-?type|xke|356|911s|carrera|930)\b/i, 3, 'rare marque/model'],
  [/convertible|roadster|speedster|spyder|spider/i, 1, 'open car'], [/4-?speed|5-?speed|manual/i, 1, 'manual'], [/rare|only-?\d+|1-?of-?\d+/i, 2, 'rarity claim'],
  [/no-?reserve/i, 1, 'no reserve'],
];

const items = new Map();
for (const f of readdirSync(dir).filter((n) => n.endsWith('.txt')).sort()) {
  for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
    const [timestamp, original, status] = line.split(' ');
    if (!/^\d{14}$/.test(timestamp ?? '') || (status && status !== '200')) continue;
    const id = original.match(/QQitemZ(\d{9,13})/)?.[1] ?? original.match(/\/(\d{9,13})(?:[?#]|$)/)?.[1] ?? original.match(/[?&]item=(\d{9,13})/)?.[1];
    if (!id) continue;
    const rawSlug = original.match(/\/ebaymotors\/([^/?_]+)/)?.[1] ?? '';
    let slug;
    try { slug = decodeURIComponent(rawSlug); } catch { slug = rawSlug; }
    slug = slug.replace(/^-+|-+$/g, '');
    const words = slug.split('-').filter(Boolean);
    const year = Number(words[0]?.match(/^(19[0-9]{2}|20[01][0-9])$/)?.[1] ?? NaN);
    const carCategory = /US_Cars_Trucks|ptZUS_Cars/.test(original);
    const partsCategory = /Parts|Accessories|ptZMotors_Car_Truck_Parts/.test(original);
    const has = items.get(id);
    if (has) { has.captures.push({ timestamp, original }); continue; }
    const reasons = [];
    let score = 0;
    if (!Number.isFinite(year) || year > maxYear) continue;
    if (!words.slice(1, 3).some((w) => MAKE_RE.test(w))) continue;
    if (partsCategory || (!carCategory && PARTS.test(slug))) continue;
    if (carCategory) { score += 2; reasons.push('car category'); }
    if (year < 1975) { score += 1; reasons.push('pre-1975'); }
    for (const [re, w, label] of COOL) if (re.test(slug)) { score += w; reasons.push(label); }
    items.set(id, { item_id: id, score, year, title: words.join(' ').slice(0, 160), reasons, captures: [{ timestamp, original }] });
  }
}
const ranked = [...items.values()].filter((i) => i.score >= minScore).sort((a, b) => b.score - a.score || a.year - b.year);
writeFileSync(out, ranked.map((r) => JSON.stringify(r)).join('\n') + (ranked.length ? '\n' : ''));
console.log(JSON.stringify({ items_seen: items.size, ranked: ranked.length, min_score: minScore, max_year: maxYear, top: ranked.slice(0, 10).map((r) => `${r.score} ${r.title}`) }, null, 1));
