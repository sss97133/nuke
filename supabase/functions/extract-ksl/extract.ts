// Pure parser for cars.ksl.com listing pages. No LLM: the page is server-rendered Next.js, and its flight payload
// (self.__next_f.push) carries the whole listing object: identity, VIN, price, mileage, location, full photo gallery,
// seller comments, createdAt/updatedAt/expiresAt. The schema.org Car block is the fallback when the payload moves.

export interface KslExtracted {
  listing_id: string;
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
  price: number | null;
  mileage: number | null;
  location: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  description: string | null;
  body_style: string | null;
  transmission: string | null;
  drivetrain: string | null;
  engine: string | null;
  fuel_type: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  title_status: string | null;
  seller_type: string | null;
  seller_name: string | null;
  image_urls: string[];
  posted_at: string | null;
  updated_at: string | null;
  expires_at: string | null;
  status: string | null;
  source: "flight_payload" | "json_ld";
}

const isoFromEpoch = (n: unknown): string | null =>
  typeof n === "number" && n > 1_000_000_000 && n < 5_000_000_000 ? new Date(n * 1000).toISOString() : null;

/** Concatenate the decoded self.__next_f.push([1,"..."]) chunks. */
export function flightText(html: string): string {
  let out = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { out += JSON.parse(m[1]); } catch { /* skip a chunk that is not a JSON string */ }
  }
  return out;
}

/** Slice the balanced JSON object that starts at s[start] === "{". */
function balanced(s: string, start: number): string | null {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

/** A flight row `4a:T4b9,text` is a text chunk of 0x4b9 UTF-8 bytes; a field holds "$4a" to point at it. */
function resolveRef(flight: string, ref: string): string | null {
  const id = ref.slice(1);
  const at = flight.search(new RegExp(`(^|\\n)${id}:T([0-9a-f]+),`));
  if (at < 0) return null;
  const m = flight.slice(at).match(new RegExp(`^\\n?${id}:T([0-9a-f]+),`))!;
  const bytes = parseInt(m[1], 16);
  const body = flight.slice(at + m[0].length);
  const enc = new TextEncoder().encode(body.slice(0, bytes * 2));
  return new TextDecoder().decode(enc.slice(0, bytes));
}

const clean = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const first = (v: unknown): string | null => (Array.isArray(v) ? clean(v[0]) : clean(v));

export function extractFromHtml(html: string, url: string): KslExtracted {
  const idFromUrl = url.match(/\/listing\/(\d+)/)?.[1] ?? "";
  const flight = flightText(html);
  const at = flight.indexOf('{"listing":{"id"');
  if (at >= 0) {
    const raw = balanced(flight, at + '{"listing":'.length);
    if (raw) {
      const L = JSON.parse(raw);
      let description = clean(L.description);
      if (description && /^\$[0-9a-f]+$/.test(description)) description = clean(resolveRef(flight, description));
      const seen = new Set<string>();
      const images: string[] = [];
      for (const p of [...(L.images ?? []), ...(L.photos ?? []), ...(L.mediaViewerItems ?? [])]) {
        const u = clean(p?.url);
        if (u && !seen.has(u)) { seen.add(u); images.push(u); }
      }
      const loc = L.location ?? {};
      const city = clean(loc.city), state = clean(loc.state);
      const spec = (label: string): string | null => {
        const row = (L.detailsSpecifications ?? []).find((r: any) => r?.label === label);
        return clean(row?.value);
      };
      const engine = [clean(L.liters), L.cylinders ? `${L.cylinders}-cylinder` : null, clean(L.fuel)].filter(Boolean).join(" ") || null;
      return {
        listing_id: String(L.id ?? idFromUrl),
        url: `https://cars.ksl.com/listing/${L.id ?? idFromUrl}`,
        title: clean(L.title),
        year: num(L.makeYear),
        make: clean(L.make),
        model: clean(L.model),
        trim: clean(L.trim),
        vin: clean(L.vin),
        price: num(L.price) && L.price > 0 ? L.price : null,
        mileage: num(L.mileage),
        location: city && state ? `${city}, ${state}` : city ?? state,
        city, state, zip: clean(loc.zip),
        description,
        body_style: clean(L.body),
        transmission: clean(L.transmission),
        drivetrain: clean(L.drive),
        engine,
        fuel_type: clean(L.fuel),
        exterior_color: first(L.paint),
        interior_color: first(L.upholstery) ?? spec("Interior Color"),
        title_status: clean(L.titleType),
        seller_type: clean(L.sellerType),
        seller_name: clean(L.dealerName) ?? clean(L.businessName) ?? clean(L.contact?.contactName),
        image_urls: images,
        posted_at: isoFromEpoch(L.createdAt),
        updated_at: isoFromEpoch(L.updatedAt),
        expires_at: isoFromEpoch(L.expiresAt),
        status: clean(L.status),
        source: "flight_payload",
      };
    }
  }
  return fromJsonLd(html, url, idFromUrl);
}

function fromJsonLd(html: string, url: string, id: string): KslExtracted {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let j: any;
    try { j = JSON.parse(m[1]); } catch { continue; }
    if (j?.["@type"] !== "Car") continue;
    const addr = j.offers?.seller?.address ?? {};
    const img = j.image?.url ? [j.image.url] : [];
    return {
      listing_id: id, url, title: clean(j.name), year: num(j.modelDate), make: clean(j.brand?.name), model: null,
      trim: clean(j.vehicleConfiguration), vin: clean(j.vehicleIdentificationNumber),
      price: num(j.offers?.price), mileage: num(j.mileageFromOdometer?.value),
      location: null, city: null, state: null, zip: clean(addr.postalCode), description: null,
      body_style: clean(j.bodyType), transmission: clean(j.vehicleTransmission), drivetrain: null,
      engine: clean(j.vehicleEngine?.[0]?.name), fuel_type: clean(j.fuelType),
      exterior_color: clean(j.color), interior_color: clean(j.vehicleInteriorColor), title_status: null,
      seller_type: null, seller_name: null, image_urls: img, posted_at: null, updated_at: null, expires_at: null,
      status: null, source: "json_ld",
    };
  }
  throw new Error("no KSL listing payload or Car JSON-LD on the page");
}
