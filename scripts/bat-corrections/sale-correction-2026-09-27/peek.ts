// Part of the 2026-09-27 BaT sale-correction chain. Recovered 2026-10-15 from the untracked ~/nuke/scripts/data/batwriter/.
// Reads archived lot pages from a local folder; does not touch prod.
function readCommentsJson(html: string): any[] | null {
  const key = '"comments":[';
  let at = html.indexOf(key);
  while (at >= 0) {
    const start = at + key.length - 1;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < html.length; i++) {
      const ch = html[i];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true; else if (ch === "[") depth++;
      else if (ch === "]" && --depth === 0) { try { const arr = JSON.parse(html.slice(start, i + 1)); if (Array.isArray(arr) && arr.length && typeof arr[0] === "object") return arr; } catch {} break; }
    }
    at = html.indexOf(key, at + key.length);
  }
  return null;
}
for (const slug of Deno.args) {
  const bytes = await Deno.readFile(`scripts/data/bat-lots/html/${slug}.html.gz`);
  const html = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  const c = readCommentsJson(html) ?? [];
  const recs = c.filter((x: any) => ["bat-bid-reserve", "bat-rnm-accepted", "bat-bid-canceled"].includes(x?.type));
  console.log(`== ${slug}: ${c.length} comments, ${c.filter((x: any) => x?.type === "bat-bid").length} bids, keys=${Object.keys(c[0] ?? {}).join(",")}`);
  for (const r of recs) console.log(JSON.stringify({ type: r.type, authorName: r.authorName, authorId: r.authorId, timestamp: r.timestamp, bidAmount: r.bidAmount, content: String(r.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300) }));
  const bids = c.filter((x: any) => x?.type === "bat-bid").slice(-2);
  for (const b of bids) console.log(JSON.stringify({ type: b.type, authorName: b.authorName, bidAmount: b.bidAmount, timestamp: b.timestamp, content: String(b.content ?? "").replace(/<[^>]+>/g, " ").slice(0, 120) }));
}
