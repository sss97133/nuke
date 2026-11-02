import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = path.join(root, 'nuke_frontend/public/stacks/makes/emblems');
const assets = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261031034021_vehicle_identity_mark_assets.sql'), 'utf8');
const registrations = [...migration.matchAll(/\$asset\$(.*?)\$asset\$::jsonb/g)].map(match => JSON.parse(match[1]));

test('retained originals and actual vector paths match the registered bytes and dimensions', () => {
  for (const asset of assets) {
    for (const kind of ['source', 'vector']) {
      const bytes = fs.readFileSync(path.join(directory, asset[kind]));
      const sha256 = crypto.createHash('sha256').update(bytes).digest('base64');
      assert.equal(sha256, asset[`${kind}Sha256Base64`]);
      assert.ok(asset[kind].includes(Buffer.from(sha256, 'base64').toString('hex').slice(0, 12)), 'Published paths must change when bytes change');
      const row = registrations.find(row => row.id === asset[`${kind}AssetId`]);
      assert.equal(row?.sha256_base64, sha256);
      assert.equal(row.asset_path, `/stacks/makes/emblems/${asset[kind]}`);
      assert.equal(row.identity_mark_id, null, 'Unknown applicability must not become a factory binding');
      assert.equal(row.observed_at, null, 'Registration date must not become source capture date');
      if (kind === 'vector') {
        const svg = bytes.toString();
        assert.match(svg, /<path\b/);
        assert.doesNotMatch(svg, /<(image|text|script|foreignObject|use)\b|(?:href|onload)\s*=/i);
        assert.match(svg, new RegExp(`viewBox="0 0 ${row.width} ${row.height}"`));
        assert.equal(row.source_asset_id, asset.sourceAssetId);
        assert.deepEqual(row.method_parameters, asset.parameters);
      }
    }
  }
});
