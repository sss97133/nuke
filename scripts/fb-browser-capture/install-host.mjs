#!/usr/bin/env node
// Prepare the native host for the exact reviewed bundle ID before unpacked installation.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { HOST } from './extension/core.mjs';
const args = process.argv.slice(2);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/fb-browser-capture/extension/manifest.json'), 'utf8'));
const extensionId = [...createHash('sha256').update(Buffer.from(bundle.key, 'base64')).digest().subarray(0,16)].map(b => String.fromCharCode(97+(b>>4))+String.fromCharCode(97+(b&15))).join('');
if (args.length && (args.length !== 2 || args[0] !== '--extension-id' || args[1] !== extensionId)) throw new Error('Installer accepts only the reviewed bundle extension ID');
if (process.platform !== 'darwin') throw new Error('This reviewed installer targets user-local Chrome on macOS');
const stateDir = path.join(os.homedir(), 'nuke-logs/provenance-development-2026-10-11/fb-browser-continuity');
fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const configPath = path.join(stateDir, 'host-config.json');
const config = { extensionId, node: process.execPath, dotenvx: '/opt/homebrew/bin/dotenvx', cli: path.join(repo, 'scripts/fb-import-urls.ts'), envCwd: path.join(os.homedir(), 'nuke'), stateDir: path.join(stateDir, 'captures') };
for (const key of ['node','dotenvx','cli']) fs.accessSync(config[key], fs.constants.R_OK);
if (fs.existsSync(configPath)) {
  const prior = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (prior.extensionId !== config.extensionId) throw new Error('Existing host belongs to another extension; explicit repair required');
}

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const launcher = path.join(stateDir, 'native-host');
const manifests = path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts');
fs.mkdirSync(manifests, { recursive: true });
const manifest = path.join(manifests, `${HOST}.json`);
const value = { name: HOST, description: 'Nuke permitted Marketplace capture intake', path: launcher, type: 'stdio', allowed_origins: [`chrome-extension://${extensionId}/`] };
if (fs.existsSync(manifest) && JSON.stringify(JSON.parse(fs.readFileSync(manifest, 'utf8'))) !== JSON.stringify(value)) throw new Error('Existing native host manifest differs; review before replacing');
fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
fs.writeFileSync(launcher, `#!/bin/sh\nexport PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin\ncd ${quote(repo)} || exit 1\nexec ${quote(config.node)} --import tsx ${quote(path.join(repo, 'scripts/fb-browser-capture/bridge.mjs'))} ${quote(configPath)} "$@"\n`, { mode: 0o700 });
fs.chmodSync(launcher, 0o700);
fs.writeFileSync(manifest, JSON.stringify(value, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ installed: manifest, extensionId, stateDir, collectorStarted: false }));
