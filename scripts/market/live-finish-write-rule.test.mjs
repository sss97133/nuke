import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldWriteEstimate } from './live-finish.mjs';

const bound = (event, url = 'https://bringatrailer.com/listing/fixture') => ({
  source_identity_basis: 'retained_native_current_episode', source_event_id: event, source_listing_url: url,
});
const row = (notes = {}) => ({ current_bid: 100, hours_remaining: 7, notes });
const prior = (notes = {}) => ({ current_bid: 100, hours_remaining: 7.5, notes: JSON.stringify(notes) });

test('new or changed verified episode writes even if the bid and horizon did not change', () => {
  assert.equal(shouldWriteEstimate(row(bound('event-a')), prior()), true);
  assert.equal(shouldWriteEstimate(row(bound('event-b')), prior(bound('event-a'))), true);
  assert.equal(shouldWriteEstimate(row(bound('event-a')), { ...prior(), notes: 'not json' }), true);
  assert.equal(shouldWriteEstimate(row(bound('event-a')), prior(bound('event-a'))), false);
  assert.equal(shouldWriteEstimate(row({ ...bound('event-a'), source_identity_basis: 'canonical_native_fold' }), prior(bound('event-a'))), false);
});

test('normal bid and horizon changes still write; an unavailable binding is not invented', () => {
  assert.equal(shouldWriteEstimate(row(), prior()), false);
  assert.equal(shouldWriteEstimate(row(), prior(bound('event-a'))), false);
  assert.equal(shouldWriteEstimate({ ...row(), current_bid: 101 }, prior()), true);
  assert.equal(shouldWriteEstimate({ ...row(), hours_remaining: 5.9 }, prior()), true);
  assert.equal(shouldWriteEstimate(row(), undefined), true);
});
