import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getKnownAuctions } from '../../../../supabase/functions/extract-rmsothebys/knownAuctions';

// Pins the RM Sotheby's auction-code table to what each RM auction page states (rmsothebys.com/auctions/<code>/,
// captured 2026-10-06 through archiveFetch into listing_page_snapshots). extract-rmsothebys dates every sold lot of
// an auction from this table, so a drifted line becomes a wrong sale date on every lot.
const PAGES = [
  { code: 'AZ24', name: 'Arizona 2024', header: '25 January 2024', first: '2024-01-25', last: '2024-01-25', snapshot: '3856bb78-8288-43ab-af95-9f3c79f79d4b' },
  { code: 'PA24', name: 'Paris 2024', header: '31 January 2024', first: '2024-01-31', last: '2024-01-31', snapshot: '421d6674-3d86-49d9-a5d6-7eac4e09afb1' },
  { code: 'MO24', name: 'Monterey 2024', header: '15 - 17 August 2024', first: '2024-08-15', last: '2024-08-17', snapshot: 'f4da52df-c414-4feb-818f-db6aa49bea2f' },
  { code: 'AZ25', name: 'Arizona 2025', header: '24 January 2025', first: '2025-01-24', last: '2025-01-24', snapshot: 'f28374cf-8f5e-4437-9419-cbbb3e49d9da' },
  { code: 'PA25', name: 'Paris 2025', header: '4 - 5 February 2025', first: '2025-02-04', last: '2025-02-05', snapshot: '642352d6-9356-4a1a-af3b-34004c9f3366' },
  { code: 'MI25', name: 'Miami 2025', header: '27 - 28 February 2025', first: '2025-02-27', last: '2025-02-28', snapshot: '13ab1717-8c72-4ab4-917a-9b5ae556ff86' },
  { code: 'MO25', name: 'Monterey 2025', header: '15 - 16 August 2025', first: '2025-08-15', last: '2025-08-16', snapshot: 'caf5c600-bf9d-4e99-a90b-48d8c05caea0' },
  { code: 'AZ26', name: 'Arizona 2026', header: '23 January 2026', first: '2026-01-23', last: '2026-01-23', snapshot: 'ea2fb9b9-ab08-4ffd-b74c-b5df50f673b1' },
  { code: 'PA26', name: 'Paris 2026', header: '28 January 2026', first: '2026-01-28', last: '2026-01-28', snapshot: '0e9e873b-a054-45e0-ac23-481a9908d201' },
  { code: 'MI26', name: 'Miami 2026', header: '27 February 2026', first: '2026-02-27', last: '2026-02-27', snapshot: '6b84e34b-b10e-49a6-8d98-73a372244e25' },
];

const source = readFileSync(
  new URL('../../../../supabase/functions/extract-rmsothebys/knownAuctions.ts', import.meta.url),
  'utf8',
);
const lineFor = (code: string) => source.split('\n').find((l) => l.includes(`code: '${code}'`)) ?? '';

describe('RM Sotheby\'s auction-code table matches the auction pages', () => {
  const table = getKnownAuctions();

  for (const page of PAGES) {
    it(`${page.code} sale day is the first day its page states (${page.header})`, () => {
      const entry = table.find((a) => a.code === page.code);
      expect(entry).toBeDefined();
      expect(entry!.date).toBe(page.first);
      expect(entry!.name).toBe(page.name);
      expect(entry!.date <= page.last).toBe(true);
    });

    it(`${page.code} line cites its listing_page_snapshots id and the stated range`, () => {
      const line = lineFor(page.code);
      expect(line).toContain(`listing_page_snapshots ${page.snapshot}`);
      expect(line).toContain(`page: "${page.header}"`);
    });
  }

  it('MO is Monterey, never Monaco (RM\'s Monaco code is MC)', () => {
    for (const entry of table.filter((a) => a.code.startsWith('MO'))) {
      expect(entry.name).toMatch(/^Monterey /);
      expect(entry.date.slice(5, 7)).toBe('08');
    }
  });

  it('codes are unique and every date is a real ISO day', () => {
    expect(new Set(table.map((a) => a.code)).size).toBe(table.length);
    for (const a of table) {
      expect(a.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${a.date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(a.date);
    }
  });
});
