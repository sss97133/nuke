import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// A read that returns or filters on ai_scan_metadata goes through vehicle_images_public (VEHICLE_IMAGES_READ), which
// strips the withheld paths for a caller not tied to the car. The table serves the raw column until its grant is revoked
// (and then refuses it), so a vehicle_images query chain that selects `*`, vehicleImageRowColumns() or a list naming
// ai_scan_metadata, or filters on it, leaks place hints, detected text and plate text today and fails after the revoke.

const SRC = join(__dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : files(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

/** Each `.from('vehicle_images')` query chain that returns or filters on ai_scan_metadata, as file:line. */
export function rawScanMetadataReads(source: string, file = 'source'): string[] {
  const hits: string[] = [];
  // Identifiers bound to a select list that names ai_scan_metadata (`const SELECT = '...ai_scan_metadata...'`).
  const scanLists = new Set<string>();
  for (const m of source.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(['"`])([\s\S]*?)\2/g)) {
    if (/ai_scan_metadata/.test(m[3])) scanLists.add(m[1]);
  }
  const re = /\.from\(\s*(['"`])vehicle_images\1\s*\)/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    const rest = source.slice(m.index + m[0].length);
    const end = rest.search(/;|\.from\(/);
    const chain = end < 0 ? rest : rest.slice(0, end);
    const select = /\.select\(\s*([^),]*)/.exec(chain)?.[1] ?? '';
    // A write chain carries ai_scan_metadata in its payload; it reads the column only through what its select returns.
    const write = /^\s*\.\s*(insert|update|upsert|delete)\(/.test(chain);
    const returnsScan = (write ? /ai_scan_metadata/.test(select) : /ai_scan_metadata/.test(chain))
      || /vehicleImageRowColumns/.test(select)
      || /^(['"`])\s*\*\s*\1/.test(select.trim())
      || /\.select\(\s*\)/.test(chain)
      || scanLists.has(select.trim());
    if (returnsScan) hits.push(`${file}:${source.slice(0, m.index).split('\n').length}`);
  }
  // An embed of the table from another relation (`vehicle_images(*)`, `alias:vehicle_images!fk(ai_scan_metadata)`).
  for (const e of source.matchAll(/(?<![\w:])(?:[A-Za-z_]\w*:)?vehicle_images(?:![\w]+)?\s*\(([^)]*)\)/g)) {
    if (/(^|,)\s*\*\s*(,|$)/.test(e[1]) || /ai_scan_metadata/.test(e[1])) {
      const before = source.slice(Math.max(0, e.index! - 8), e.index!);
      if (!/from\(\s*['"`]$/.test(before)) hits.push(`${file}:${source.slice(0, e.index).split('\n').length}`);
    }
  }
  return hits;
}

describe('ai_scan_metadata reads go through vehicle_images_public', () => {
  it('flags a table chain that selects *, the row columns or the column, or filters on it; passes the view', () => {
    expect(rawScanMetadataReads(`supabase.from('vehicle_images').select('*').eq('id', x)`)).toHaveLength(1);
    expect(rawScanMetadataReads(`supabase\n  .from("vehicle_images")\n  .select(await vehicleImageRowColumns())`)).toHaveLength(1);
    expect(rawScanMetadataReads(`supabase.from('vehicle_images').select('id, ai_scan_metadata')`)).toHaveLength(1);
    expect(rawScanMetadataReads(`supabase.from('vehicle_images').select('id', { head: true }).not('ai_scan_metadata->a', 'is', null);`)).toHaveLength(1);
    expect(rawScanMetadataReads(`const S = 'id, x:ai_scan_metadata->y';\nsupabase.from('vehicle_images').select(S);`)).toHaveLength(1);
    expect(rawScanMetadataReads(`supabase.from('vehicle_images').select('id, image_url'); const a = row.ai_scan_metadata;`)).toHaveLength(0);
    expect(rawScanMetadataReads(`supabase.from(VEHICLE_IMAGES_READ).select('*')`)).toHaveLength(0);
    expect(rawScanMetadataReads(`supabase.from('vehicle_images').update({ ai_scan_metadata: m }).eq('id', x);`)).toHaveLength(0);
    expect(rawScanMetadataReads(`supabase.from('vehicle_images').update({ ai_scan_metadata: m }).select('*');`)).toHaveLength(1);
    expect(rawScanMetadataReads(`supabase.from('vehicle_images').insert(row).select().single();`)).toHaveLength(1);
    expect(rawScanMetadataReads("supabase.from('image_set_members').select(`*, vehicle_images (*)`)")).toHaveLength(1);
    expect(rawScanMetadataReads("supabase.from('x').select('id, img:vehicle_images!fk(ai_scan_metadata)')")).toHaveLength(1);
    expect(rawScanMetadataReads("supabase.from('x').select('id, vehicle_images:vehicle_images_public (*)')")).toHaveLength(0);
    expect(rawScanMetadataReads("supabase.from('x').select('id, vehicle_images(image_url, is_primary)')")).toHaveLength(0);
  });

  it('no file in src reads ai_scan_metadata from the table', () => {
    const offenders = files(SRC).flatMap((f) => rawScanMetadataReads(readFileSync(f, 'utf8'), relative(SRC, f)));
    expect(offenders).toEqual([]);
  });
});

describe('the scan document costs a call per row', () => {
  it('the without-scan column list is the public list minus ai_scan_metadata only', async () => {
    const { VEHICLE_IMAGE_PUBLIC_COLUMNS, VEHICLE_IMAGE_COLUMNS_WITHOUT_SCAN } = await import('./vehicleImageColumns');
    const all = VEHICLE_IMAGE_PUBLIC_COLUMNS.split(', ');
    const without = VEHICLE_IMAGE_COLUMNS_WITHOUT_SCAN.split(', ');
    expect(without).not.toContain('ai_scan_metadata');
    expect(all.filter(c => !without.includes(c))).toEqual(['ai_scan_metadata']);
  });
});
