import { deepStrictEqual, equal, ok } from 'node:assert/strict';
import { parseListingMarkdown } from './listingParser.ts';

const URL = 'https://www.jamesedition.com/cars/porsche/911/porsche-911-for-sale-12345678';

// Synthetic structural reproduction of the retained yearless-H1 failure.
// The actual capture, source ids and seller information remain in private logs.
function listing(title = 'Porsche 911', details = 'Year\n\n2022\n\nGearbox\n\nAutomatic') {
  return `# ${title}\n\n## About This Car\n\nA described vehicle.\n\n## Car Details\n\n${details}\n\n## You Might Also Like\n\n# 2020 Ferrari Roma\n\nYear\n\n2020\n`;
}

Deno.test('yearless heading and Car Details recover identity and Gearbox', () => {
  const result = parseListingMarkdown(listing(), URL);
  deepStrictEqual([result.year, result.make, result.model, result.transmission], [2022, 'Porsche', '911', 'Automatic']);
  deepStrictEqual(result.identity_issues, []);
  equal(result.listing_id, '12345678');
});

Deno.test('ordinary year-leading heading and Transmission remain supported', () => {
  const result = parseListingMarkdown(listing('2022 Porsche 911', 'Year\n\n2022\n\nTransmission\n\nManual'), URL);
  deepStrictEqual([result.year, result.make, result.model, result.transmission], [2022, 'Porsche', '911', 'Manual']);
  deepStrictEqual(result.identity_issues, []);
});

Deno.test('year-leading heading can supply the year when details omit it', () => {
  const result = parseListingMarkdown(listing('2022 Porsche 911', 'Gearbox\n\nAutomatic'), URL);
  equal(result.year, 2022);
  deepStrictEqual(result.identity_issues, []);
});

Deno.test('source category gives an explicit multiword make boundary', () => {
  for (const [slug, title, make, model] of [
    ['aston-martin', 'Aston Martin DB9', 'Aston Martin', 'DB9'],
    ['rolls-royce', '2022 Rolls-Royce Phantom', 'Rolls-Royce', 'Phantom'],
    ['mercedes', 'Mercedes-Benz SL 500', 'Mercedes-Benz', 'SL 500'],
  ]) {
    const url = `https://www.jamesedition.com/cars/${slug}/model/listing-for-sale-12345678`;
    const result = parseListingMarkdown(listing(title), url);
    deepStrictEqual([result.year, result.make, result.model], [2022, make, model]);
    deepStrictEqual(result.identity_issues, []);
  }
});

Deno.test('title year disagreement with details stays unresolved', () => {
  const result = parseListingMarkdown(listing('2021 Porsche 911'), URL);
  equal(result.year, null);
  ok(result.identity_issues.includes('title_year_conflicts_with_details'));
});

Deno.test('a different or concatenated heading cannot borrow the category make', () => {
  for (const title of ['Ferrari Roma', '2022 Ferrari Roma', 'Porsche911', '2022 Porsche911']) {
    const result = parseListingMarkdown(listing(title), URL);
    equal(result.make, null);
    equal(result.model, null);
    ok(result.identity_issues.includes('title_make_conflicts_with_source_category'));
  }
});

Deno.test('yearless heading does not borrow a related listing year', () => {
  const result = parseListingMarkdown(listing('Porsche 911', 'Gearbox\n\nAutomatic'), URL);
  equal(result.year, null);
  ok(result.identity_issues.includes('incomplete_vehicle_identity'));
});

Deno.test('malformed structured year is not truncated to a supported year', () => {
  const result = parseListingMarkdown(listing('Porsche 911', 'Year\n\n20220'), URL);
  equal(result.year, null);
  ok(result.identity_issues.includes('invalid_details_year'));
});

Deno.test('a route is insufficient without a listing heading', () => {
  const result = parseListingMarkdown('## Car Details\n\nYear\n\n2022\n\nGearbox\n\nAutomatic\n\n## You Might Also Like\n\n# Porsche 718', URL);
  equal(result.title, null);
  equal(result.make, null);
  equal(result.model, null);
  ok(result.identity_issues.includes('incomplete_vehicle_identity'));
});

Deno.test('source corroboration requires the source host and listing route', () => {
  for (const url of [URL.replace('www.jamesedition.com', 'example.com'), URL.replace('www.jamesedition.com', 'www.jamesedition.com.example.com'), 'https://www.jamesedition.com/cars/porsche', 'invalid']) {
    const result = parseListingMarkdown(listing(), url);
    equal(result.make, null);
    equal(result.model, null);
    ok(result.identity_issues.includes('incomplete_vehicle_identity'));
  }
});

Deno.test('malformed source make category stays incomplete without throwing', () => {
  const result = parseListingMarkdown(listing('2022 Porsche 911'), URL.replace('/porsche/', '/a/'));
  equal(result.make, null);
  equal(result.model, null);
  ok(result.identity_issues.includes('incomplete_vehicle_identity'));
});

Deno.test('source path case and genuine query or fragment are preserved', () => {
  const url = URL.replace('/porsche/', '/Porsche/') + '?ref=caseSensitive#car-details';
  const result = parseListingMarkdown(listing(), url);
  equal(result.url, url);
  deepStrictEqual([result.year, result.make, result.model], [2022, 'Porsche', '911']);
  deepStrictEqual(result.identity_issues, []);
});
