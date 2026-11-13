// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
vi.mock('../hooks/usePageTitle', () => ({ usePageTitle: () => undefined }));
vi.mock('../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => <a href={to} className={className}>{children}</a> }));
import AssetProfilePage, { foldNotes, headline, money, sittingsOf, type AssetProfile } from './AssetProfile';

// The shape asset_profile_read returns for a sold print with a creation claim (synthetic values, the live shape of 2026-11-08).
const riley: AssetProfile = {
  asset: { id: '1b0b06fa-fcfa-49cf-9107-acbe0e073786', asset_type: 'artwork', title: 'BRIDGET RILEY (B. 1931) Ka 4', house_category: 'Post-War and Contemporary Art',
    house_category_code: 'PIC-CON', source: 'bonhams', identity_basis: 'lot_presentation', first_seen_at: '2026-10-15T22:59:59Z', created_at: '2026-11-08T16:07:00Z' },
  image_url: 'https://images1.bonhams.com/image?src=x.jpg',
  lots: [{ statement_id: 's1', source: { slug: 'bonhams', name: 'Bonhams', trust: 0.9 }, house_category: 'Post-War and Contemporary Art', department_code: 'PIC-CON', house_group: null,
    lot_number: '7', sale_key: 'bonhams-32184', sale_name: null, sale_ends_at: '2026-10-15T22:59:59Z', result: 'sold', price_basis: 'hammer', hammer_price: 720000, hammer_premium: 915500,
    high_bid: null, estimate_low: 550000, estimate_high: 750000, currency: 'GBP', observed_at: '2026-10-15T22:59:59Z', observed_at_basis: 'hammer_time',
    url: 'https://www.bonhams.com/auction/32184/lot/7/x', lines: ['BRIDGET RILEY', '(B. 1931)', 'Ka 4'], catalog_text: 'oil on linen\n76.2 x 67.3cm',
    printed_sections: [{ heading: 'Provenance', lines: ['Juda Rowan Gallery, London', 'Private Collection, London'] }, { heading: 'Literature', lines: ['The Complete Paintings, no. BR207'] },
      { heading: null, lines: ['With the Ka paintings of 1980, Riley gave the stripe a new chromatic intensity.'] },
      { heading: null, lines: ['In the winter of 1979 to 80 Riley spent several weeks in Egypt.'] }],
    symbols: ['AR'], image_url: 'https://images1.bonhams.com/image?src=x.jpg', country: 'United Kingdom', landed_at: '2026-11-08T16:07:00Z' }],
  history: [{ statement_id: 's0', source: 'bonhams', observed_at: '2026-09-01T12:00:00Z', observed_at_basis: 'index_read', result: 'upcoming', hammer_price: null, high_bid: null,
    estimate_low: 550000, estimate_high: 750000, currency: 'GBP', landed_at: '2026-09-01T12:00:00Z', superseded: true },
    { statement_id: 's1', source: 'bonhams', observed_at: '2026-10-15T22:59:59Z', observed_at_basis: 'hammer_time', result: 'sold', hammer_price: 720000, high_bid: null,
      estimate_low: 550000, estimate_high: 750000, currency: 'GBP', landed_at: '2026-11-08T16:07:00Z', superseded: false }],
  creation: [{ claim_id: 'c1', attribution: 'direct', layout: 'party_then_qualifier', name_as_printed: 'BRIDGET RILEY', qualifier_as_printed: 'B. 1931',
    party: { id: 'p1', display_name: 'BRIDGET RILEY', qualifier_as_printed: 'B. 1931', claimed: false, lots_direct: 3, priced_lots: 2 }, executor: null,
    source: 'bonhams', observed_at: '2026-10-15T22:59:59Z', confidence: 0.9 }],
  coverage: { presentations: 1, statements: 2, claims: 1, sources: ['bonhams'], as_of: '2026-11-08T17:00:00Z' },
};

let node: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.rpc.mockReset();
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
const render = (path: string) => root.render(<MemoryRouter initialEntries={[path]}><Routes>
  <Route path="/assets/:assetId" element={<AssetProfilePage />} />
</Routes></MemoryRouter>);

it('renders the artwork from the one typed read: identity, hammer as a claim, creation, the house\'s printed sections, every statement', async () => {
  fixture.rpc.mockResolvedValue({ data: riley, error: null });
  await act(async () => render('/assets/1b0b06fa-fcfa-49cf-9107-acbe0e073786'));
  expect(fixture.rpc).toHaveBeenCalledWith('asset_profile_read', { p_asset_id: '1b0b06fa-fcfa-49cf-9107-acbe0e073786' });
  expect(node.querySelector('h1')?.textContent).toBe('Ka 4');
  expect(node.textContent).toContain('BRIDGET RILEY');
  expect(node.textContent).toContain('£720,000');
  expect(node.querySelector('button[aria-label="Inspect the source of £720,000"]')).not.toBeNull();
  expect(node.textContent).toContain('Provenance');
  expect(node.textContent).toContain('Juda Rowan Gallery, London');
  expect(node.textContent).toContain('Lots attributed directly');
  expect(node.textContent).toContain('Not yet: the row is theirs to claim');
  expect(node.querySelectorAll('.ap-history__row').length).toBe(2);
  expect(node.querySelector('.ap-history__row--superseded')).not.toBeNull();
  const img = node.querySelector('img');
  expect(img?.getAttribute('width')).toBe('1200');
  expect(img?.getAttribute('height')).toBe('900');
  expect(node.textContent).toContain('Nuke holds 1 presentation, 2 statements and 1 creation claim');
  expect(node.querySelector('[style]')).toBeNull();
  expect(Array.from(node.querySelectorAll('h3')).filter(h => h.textContent === "The house's note").length).toBe(1);
  expect(node.textContent).toContain("Sale (the house's key)");
});

it('folds consecutive unheaded blocks into one note and leaves headed sections alone', () => {
  const folded = foldNotes([{ heading: 'Provenance', lines: ['a'] }, { heading: null, lines: ['p1'] }, { heading: null, lines: ['p2'] }, { heading: 'Literature', lines: ['b'] }, { heading: null, lines: ['p3'] }]);
  expect(folded).toEqual([{ heading: 'Provenance', lines: ['a'] }, { heading: null, lines: ['p1', 'p2'] }, { heading: 'Literature', lines: ['b'] }, { heading: null, lines: ['p3'] }]);
});

it('says so when nothing public is recorded, and never calls the reader for a malformed id', async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: null });
  await act(async () => render('/assets/00000000-0000-0000-0000-000000000000'));
  expect(node.querySelector('[role="alert"]')?.textContent).toContain('No such asset');
  await act(async () => root.unmount()); node.remove();
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  fixture.rpc.mockReset();
  await act(async () => render('/assets/not-an-id'));
  expect(fixture.rpc).not.toHaveBeenCalled();
  expect(node.textContent).toContain('No such asset');
});

it('a declared work shows no public sale, the holder\'s words and a user party', async () => {
  const declared: AssetProfile = { ...riley, asset: { ...riley.asset, id: '22222222-2222-4222-8222-222222222222', title: 'Danger End of Road', house_category: null, identity_basis: 'holder_declaration', visibility: 'private' },
    viewer: { is_holder: true }, declared: { medium: 'oil and enamel on canvas', year: 'c. 2024', dimensions: '48 x 60 in', notes: 'Painted at the shop.' }, market: 'none_public',
    image_url: null, lots: [], history: [],
    creation: [{ claim_id: 'c9', attribution: 'direct', layout: 'holder_declaration', name_as_printed: 'A Working Photographer', qualifier_as_printed: null,
      party: { id: 'u1', kind: 'user', display_name: 'A Working Photographer', claimed: true, lots_direct: 1, priced_lots: 0 }, executor: null, source: 'owner-input', observed_at: '2026-11-08T21:00:00Z', confidence: 0.95 }],
    coverage: { presentations: 0, statements: 0, claims: 1, sources: [], as_of: '2026-11-08T22:00:00Z' } };
  fixture.rpc.mockResolvedValue({ data: declared, error: null });
  await act(async () => render('/assets/22222222-2222-4222-8222-222222222222'));
  expect(node.textContent).toContain('No public sale recorded');
  expect(node.textContent).toContain('In the words of the person who recorded it');
  expect(node.textContent).toContain('oil and enamel on canvas');
  expect(node.textContent).toContain('Painted at the shop.');
  expect(node.textContent).toContain('A Nuke user, in their own words');
  expect(node.textContent).toContain("the holder's own declaration");
  expect(node.textContent).toContain('declared by its holder in their own words');
  expect(node.querySelector('img')).toBeNull();
});

it('a work found in the photos shows what the analysis saw, the days photographed, and the holder\'s verbs', async () => {
  const found: AssetProfile = { ...riley, asset: { ...riley.asset, id: '33333333-3333-4333-8333-333333333333', title: 'Proposed painting, Jul 2024', house_category: null, identity_basis: 'photo_proposal', visibility: 'private' },
    viewer: { is_holder: false, is_record_origin: true }, declared: null, market: 'none_public', image_url: null, lots: [], history: [], creation: [],
    proposal: { kind: 'painting', labels: ['Painting', 'Modern Art'], labeller: 'apple_photos_on_device_v1', method: 'apple_vision_featureprint_cos0.90', photos: 2, sittings: 2,
      span_from: '2024-07-03T18:00:00Z', span_to: '2026-09-13T20:00:00Z', places: [['Boulder City, United States', 2]], status: 'pending',
      photo_sightings: [{ taken_at: '2024-07-03T18:00:00Z', filename: 'IMG_1.HEIC', place: 'Boulder City, United States', caption: 'a painting of a red car' },
        { taken_at: '2026-09-13T20:00:00Z', filename: 'IMG_2.HEIC', place: 'Boulder City, United States', caption: 'a red painting on a black wall' }] },
    coverage: { presentations: 0, statements: 0, claims: 0, sources: [], as_of: '2026-11-09T01:00:00Z' } };
  fixture.rpc.mockResolvedValue({ data: found, error: null });
  await act(async () => render('/assets/33333333-3333-4333-8333-333333333333'));
  expect(node.textContent).toContain('Found in your photographs');
  expect(node.textContent).toContain('Awaiting you: keep it as documentation, or discard it');
  expect(node.textContent).toContain('Keep as documentation');
  expect(node.textContent).not.toContain('This is my work');
  expect(node.textContent).toContain('First photographed');
  expect(node.textContent).toContain('Days photographed');
  expect(node.textContent).toContain("the device's caption: a painting of a red car");
  expect(node.textContent).toContain('nothing left the machine');
  expect(node.querySelector('a[href="/assets/new?confirm=33333333-3333-4333-8333-333333333333"]')).not.toBeNull();
  expect(node.textContent).toContain('No public sale recorded');
  expect(sittingsOf(found.proposal!.photo_sightings!).length).toBe(2);
});

it('formats money by the house\'s currency and headlines the hammer, then the high bid, then the estimate', () => {
  expect(money(720000, 'GBP')).toBe('£720,000');
  expect(money(1416, 'USD')).toBe('$1,416');
  const lot = riley.lots[0];
  expect(headline(lot)).toEqual({ label: 'Sold · Bonhams', value: '£720,000' });
  expect(headline({ ...lot, hammer_price: null, high_bid: 300, result: 'not_sold' })).toEqual({ label: 'Not sold · high bid', value: '£300' });
  expect(headline({ ...lot, hammer_price: null, result: 'upcoming' })).toEqual({ label: 'Upcoming · estimate', value: '£550,000 to £750,000' });
});

it('a holder who is not the record origin gets no keep/discard verbs; a legacy record and a stated claim read as unverified (PR #3190)', async () => {
  const base: AssetProfile = { ...riley, asset: { ...riley.asset, id: '66666666-6666-4666-8666-666666666666', title: 'Old confirm', house_category: null, identity_basis: 'photo_proposal', visibility: 'private' },
    viewer: { is_holder: true, is_record_origin: false, legacy_compound: true }, declared: null, market: 'none_public', image_url: null, lots: [], history: [],
    creation: [{ claim_id: 'c1', attribution: 'by', layout: 'holder_declaration', name_as_printed: null, qualifier_as_printed: null, party: { id: 'u', kind: 'user', display_name: 'A Working Photographer', claimed: true, lots_direct: 0, priced_lots: 0 },
      executor: null, source: 'owner-input', observed_at: '2026-11-01T00:00:00Z', confidence: null, role: 'creator', claim_state: 'stated', qualification: 'legacy_compound_unverified', basis: 'legacy_compound_sign' }],
    proposal: { kind: 'painting', photos: 1, status: 'pending', photo_sightings: [] },
    coverage: { presentations: 0, statements: 0, claims: 1, sources: [], as_of: '2026-11-09T01:00:00Z' } };
  fixture.rpc.mockResolvedValue({ data: base, error: null });
  await act(async () => render('/assets/66666666-6666-4666-8666-666666666666'));
  expect(node.querySelector('a[href="/assets/new?confirm=66666666-6666-4666-8666-666666666666"]')).toBeNull();
  expect(node.textContent).toContain('Not yet kept by the person whose photos found it');
  expect(node.textContent).toContain('Recorded under the earlier single confirmation');
  expect(node.textContent).toContain('Recorded by the earlier single confirmation; unverified');
});
