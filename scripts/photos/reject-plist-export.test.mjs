import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlistExport } from './reject-plist-export.mjs';

test('rejects XML and binary property lists even with an image filename', () => {
  assert.equal(isPlistExport(Buffer.from('<?xml version="1.0"?><!DOCTYPE plist><plist version="1.0"><dict/></plist>')), true);
  assert.equal(isPlistExport(Buffer.from('bplist00synthetic')), true);
});

test('does not reject ordinary image data or arbitrary XML', () => {
  assert.equal(isPlistExport(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), false);
  assert.equal(isPlistExport(Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])), false);
  assert.equal(isPlistExport(Buffer.from('<?xml version="1.0"?><root/>')), false);
});
