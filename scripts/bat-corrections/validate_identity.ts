// validate_identity.ts <list-of-html.gz-paths> — run the shared BaT identity readers over saved lot pages and
// measure them against BaT's own Make link on the same page (the oracle) and the archive's taxonomy.jsonl.
import { parseBatIdentityFromUrl, parseBatIdentityFromTitle, readBatTaxonomy, cleanBatTitle } from "../../supabase/functions/_shared/batParser.ts";

const list = (await Deno.readTextFile(Deno.args[0])).split("\n").filter(Boolean);
const norm = (s: string | null) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
let n = 0, withMakeLink = 0, urlMake = 0, urlAgree = 0, titleMake = 0, titleAgree = 0, oldFirstWordAgree = 0, oldFirstWordMake = 0;
let yearless = 0, yearlessUrlMake = 0, yearlessTitleMake = 0;
const dis: string[] = [], disT: string[] = [], disOld: string[] = [];
for (const path of list) {
  const gz = await Deno.readFile(path);
  const html = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  const slug = path.split("/").pop()!.replace(/\.html\.gz$/, "");
  const url = `https://bringatrailer.com/listing/${slug}/`;
  const h1 = html.match(/<h1[^>]*class=["'][^"']*post-title[^"']*["'][^>]*>([^<]+)<\/h1>/i)?.[1] ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "";
  const title = cleanBatTitle(h1);
  n++;
  const tax = readBatTaxonomy(html);
  const u = parseBatIdentityFromUrl(url);
  const t = parseBatIdentityFromTitle(title, u.make);
  const hasYear = /\b(18|19|20)\d{2}\b/.test(title);
  if (!hasYear) { yearless++; if (u.make) yearlessUrlMake++; if (t.make) yearlessTitleMake++; }
  // the old sync's first-word split (year anywhere else first word)
  const ym = title.match(/\b(19\d{2}|20[0-2]\d)\s+/);
  const oldMake = ym ? title.slice(ym.index! + ym[0].length).trim().split(/\s+/)[0] : title.split(/\s+/)[0];
  if (!tax.make) continue;
  withMakeLink++;
  if (u.make) { urlMake++; if (norm(u.make) === norm(tax.make) || norm(tax.make).startsWith(norm(u.make))) urlAgree++; else if (dis.length < 12) dis.push(`${slug}: url=${u.make} | bat=${tax.make}`); }
  if (t.make) { titleMake++; if (norm(t.make) === norm(tax.make) || norm(tax.make).startsWith(norm(t.make))) titleAgree++; else if (disT.length < 12) disT.push(`${slug}: title=${t.make} | bat=${tax.make} | "${title}"`); }
  if (oldMake) { oldFirstWordMake++; if (norm(oldMake) === norm(tax.make) || norm(tax.make).startsWith(norm(oldMake))) oldFirstWordAgree++; else if (disOld.length < 8) disOld.push(`${slug}: old=${oldMake} | bat=${tax.make}`); }
}
console.log(JSON.stringify({ pages: n, with_bat_make_link: withMakeLink, url_parse_make: urlMake, url_agree: urlAgree, url_agree_pct: +(100 * urlAgree / Math.max(1, urlMake)).toFixed(2),
  title_parse_make: titleMake, title_agree: titleAgree, title_agree_pct: +(100 * titleAgree / Math.max(1, titleMake)).toFixed(2),
  old_first_word_make: oldFirstWordMake, old_first_word_agree: oldFirstWordAgree, old_first_word_agree_pct: +(100 * oldFirstWordAgree / Math.max(1, oldFirstWordMake)).toFixed(2),
  yearless_titles: yearless, yearless_url_make: yearlessUrlMake, yearless_title_make: yearlessTitleMake }));
console.log("url vs BaT disagreements:", dis);
console.log("title vs BaT disagreements:", disT);
console.log("old first-word vs BaT disagreements:", disOld);
