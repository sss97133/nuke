// Free pilot: on-device OCR (scripts/ocr/vision-ocr.swift) over classic GM truck photos, looking for GM SPID labels
// and legible trim badges. Read-only: it writes nothing to the database. It saves a receipt and the flagged images
// under ~/nuke-logs/image-ocr-pilot/ so precision can be checked by eye before any claim is recorded.
//
//   cd ~/nuke && dotenvx run -q -- deno run --allow-net --allow-env --allow-read --allow-write --allow-run \
//     ~/.worktrees/<task>/scripts/image-ocr-pilot.ts [--vehicles 50] [--images 40]
const args = Deno.args;
const option = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const vehicleTarget = Math.min(80, Number(option("vehicles") ?? 50));
const imagesPer = Math.min(80, Number(option("images") ?? 40));
const base = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const swift = new URL("./ocr/vision-ocr.swift", import.meta.url).pathname;

async function rest<T>(path: string): Promise<T> {
  const res = await fetch(`${base}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`${path.split("?")[0]} ${res.status}`);
  return await res.json();
}
type Vehicle = { id: string; year: number; make: string; model: string; listing_title: string | null; trim: string | null };
type Image = { id: string; medium_url: string | null; image_url: string | null; thumbnail_url: string | null };

// Trim names GM put on fenders and tailgates in this era; a badge counts only when a whole OCR line is one of them.
const TRIMS = ["CHEYENNE SUPER", "CUSTOM DELUXE", "SIERRA CLASSIC", "SIERRA GRANDE", "HIGH SIERRA", "SUPER CUSTOM",
  "SILVERADO", "SCOTTSDALE", "CHEYENNE", "BIG 10", "CST", "SIERRA", "CUSTOM"];
const SPID_HEADER = /SERVICE\s+PARTS\s+IDENTIFICATION|DO\s+NOT\s+REMOVE|PARTS\s+IDENTIFICATION/i;
const RPO = /^(?=[A-Z0-9]{3}$)(?=.*[A-Z])(?=.*\d)[A-Z0-9]{3}$/;

function classify(lines: Array<{ text: string; confidence: number }>) {
  const confident = lines.filter(l => l.confidence >= 0.5);
  const tokens = confident.flatMap(l => l.text.toUpperCase().split(/[^A-Z0-9]+/)).filter(Boolean);
  const codes = [...new Set(tokens.filter(t => RPO.test(t)))];
  const header = confident.some(l => SPID_HEADER.test(l.text));
  const spid = (header && codes.length >= 6) || codes.length >= 15;
  const badges = [...new Set(confident.filter(l => l.confidence >= 0.8)
    .map(l => l.text.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim())
    .filter(t => TRIMS.includes(t)))];
  return { spid, header, codes: spid ? codes : [], badges };
}

const picks: Vehicle[] = [];
for (const [make, model, want] of [["Chevrolet", "c10", 30], ["Chevrolet", "k10", 10], ["GMC", "sierra", 10]] as const) {
  for (let year = 1973; year <= 1987 && picks.filter(p => p.make === make && p.model.toLowerCase().includes(model)).length < want; year++) {
    picks.push(...(await rest<Vehicle[]>(`vehicles?select=id,year,make,model,listing_title,trim&make=eq.${make}&year=eq.${year}` +
      `&model=ilike.*${model}*&is_public=eq.true&deleted_at=is.null&listing_title=not.is.null&order=id.asc&limit=2`)));
  }
}
const vehicles = picks.slice(0, vehicleTarget);

const runDir = `${Deno.env.get("HOME")}/nuke-logs/image-ocr-pilot/${new Date().toISOString().replace(/[:.]/g, "-")}`;
await Deno.mkdir(`${runDir}/flagged`, { recursive: true });
const tmp = await Deno.makeTempDir();
const results: any[] = [];
let imagesRead = 0;
const started = Date.now();

for (const v of vehicles) {
  const images = await rest<Image[]>(`vehicle_images?select=id,medium_url,image_url,thumbnail_url&vehicle_id=eq.${v.id}` +
    `&is_superseded=not.is.true&order=position.asc.nullslast,created_at.asc&limit=${imagesPer}`);
  const files: Array<{ img: Image; path: string }> = [];
  await Promise.all(images.map(async (img, i) => {
    const url = img.medium_url ?? img.image_url ?? img.thumbnail_url; if (!url) return;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (!res.ok) return;
      const path = `${tmp}/${v.id}-${i}.jpg`; await Deno.writeFile(path, new Uint8Array(await res.arrayBuffer()));
      files.push({ img, path });
    } catch { /* unreachable image */ }
  }));
  const row: any = { vehicle_id: v.id, title: v.listing_title, recorded_trim: v.trim, images: files.length, spid: [], badges: [] };
  if (files.length) {
    const out = await new Deno.Command("swift", { args: [swift, ...files.map(f => f.path)], stdout: "piped", stderr: "null" }).output();
    for (const line of new TextDecoder().decode(out.stdout).split("\n").filter(Boolean)) {
      const r = JSON.parse(line); imagesRead++;
      const f = files.find(x => x.path === r.path)!;
      const c = classify(r.lines ?? []);
      if (c.spid) { row.spid.push({ image_id: f.img.id, header: c.header, codes: c.codes }); await Deno.copyFile(f.path, `${runDir}/flagged/spid-${f.img.id}.jpg`); }
      for (const b of c.badges) { row.badges.push({ image_id: f.img.id, text: b }); await Deno.copyFile(f.path, `${runDir}/flagged/badge-${f.img.id}.jpg`); }
    }
  }
  results.push(row);
  console.log(v.year, v.model, `imgs=${row.images}`, `spid=${row.spid.length}`, `badges=${row.badges.map((b: any) => b.text).join("/")}`);
  for (const f of files) await Deno.remove(f.path).catch(() => {});
}

const titleAgrees = results.filter(r => r.badges.length && r.title && r.badges.some((b: any) => r.title.toUpperCase().includes(b.text))).length;
const summary = { vehicles: results.length, images_read: imagesRead, seconds: Math.round((Date.now() - started) / 1000), usd: 0,
  vehicles_with_spid: results.filter(r => r.spid.length).length, vehicles_with_badge: results.filter(r => r.badges.length).length,
  badge_vehicles_whose_title_names_the_badge: titleAgrees, flagged_dir: `${runDir}/flagged` };
await Deno.writeTextFile(`${runDir}/receipt.json`, JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary));
