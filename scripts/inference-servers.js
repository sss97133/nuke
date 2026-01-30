#!/usr/bin/env node
/**
 * INFERENCE SERVERS CLI
 *
 * Manage multi-server inference configuration.
 *
 * Usage:
 *   node scripts/inference-servers.js list
 *   node scripts/inference-servers.js enable <name>
 *   node scripts/inference-servers.js disable <name>
 *   node scripts/inference-servers.js add <name> <url> <model> [--type=ollama] [--priority=2]
 *   node scripts/inference-servers.js test [name]
 *   node scripts/inference-servers.js set <name> <key> <value>
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '../config/inference-servers.json');

function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
}

function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

async function testServer(server) {
  const start = Date.now();
  try {
    if (server.type === 'ollama') {
      const res = await fetch(`${server.url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: server.model,
          messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
          stream: false,
          options: { num_predict: 10 }
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return { ok: true, ms: Date.now() - start, response: data.message?.content?.slice(0, 50) };
    } else {
      // OpenAI-compatible
      const apiKey = server.apiKeyEnv ? process.env[server.apiKeyEnv] : server.apiKey;
      if (!apiKey) return { ok: false, error: 'No API key' };

      const res = await fetch(server.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: server.model,
          messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
          max_tokens: 10,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return { ok: true, ms: Date.now() - start, response: data.choices?.[0]?.message?.content?.slice(0, 50) };
    }
  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: e.message };
  }
}

async function main() {
  const [,, command, ...args] = process.argv;
  const config = loadConfig();

  switch (command) {
    case 'list':
    case 'ls':
    case undefined: {
      console.log('\nInference Servers:\n');
      console.log('  NAME            TYPE      MODEL                    PRIORITY  STATUS');
      console.log('  ' + '─'.repeat(70));
      for (const s of config.servers) {
        const status = s.enabled ? '\x1b[32m✓ enabled\x1b[0m' : '\x1b[90mdisabled\x1b[0m';
        console.log(`  ${s.name.padEnd(15)} ${s.type.padEnd(9)} ${s.model.padEnd(24)} ${String(s.priority).padEnd(9)} ${status}`);
      }
      console.log(`\n  Strategy: ${config.strategy}`);
      console.log('');
      break;
    }

    case 'enable': {
      const name = args[0];
      const server = config.servers.find(s => s.name === name);
      if (!server) {
        console.error(`Server '${name}' not found`);
        process.exit(1);
      }
      server.enabled = true;
      saveConfig(config);
      console.log(`Enabled ${name}`);
      break;
    }

    case 'disable': {
      const name = args[0];
      const server = config.servers.find(s => s.name === name);
      if (!server) {
        console.error(`Server '${name}' not found`);
        process.exit(1);
      }
      server.enabled = false;
      saveConfig(config);
      console.log(`Disabled ${name}`);
      break;
    }

    case 'add': {
      const [name, url, model] = args;
      if (!name || !url || !model) {
        console.error('Usage: add <name> <url> <model>');
        process.exit(1);
      }
      const type = args.find(a => a.startsWith('--type='))?.split('=')[1] || 'ollama';
      const priority = parseInt(args.find(a => a.startsWith('--priority='))?.split('=')[1] || '2');

      config.servers.push({
        name,
        url,
        type,
        model,
        priority,
        rateLimit: null,
        timeout: type === 'ollama' ? 120000 : 30000,
        enabled: false,
      });
      saveConfig(config);
      console.log(`Added ${name} (${type}) - run 'enable ${name}' to activate`);
      break;
    }

    case 'remove':
    case 'rm': {
      const name = args[0];
      const idx = config.servers.findIndex(s => s.name === name);
      if (idx === -1) {
        console.error(`Server '${name}' not found`);
        process.exit(1);
      }
      config.servers.splice(idx, 1);
      saveConfig(config);
      console.log(`Removed ${name}`);
      break;
    }

    case 'set': {
      const [name, key, value] = args;
      const server = config.servers.find(s => s.name === name);
      if (!server) {
        console.error(`Server '${name}' not found`);
        process.exit(1);
      }
      // Parse value
      let parsed = value;
      if (value === 'true') parsed = true;
      else if (value === 'false') parsed = false;
      else if (value === 'null') parsed = null;
      else if (!isNaN(Number(value))) parsed = Number(value);

      server[key] = parsed;
      saveConfig(config);
      console.log(`Set ${name}.${key} = ${JSON.stringify(parsed)}`);
      break;
    }

    case 'test': {
      const name = args[0];
      const servers = name
        ? config.servers.filter(s => s.name === name)
        : config.servers;

      console.log('\nTesting servers...\n');
      for (const s of servers) {
        process.stdout.write(`  ${s.name.padEnd(15)} `);
        const result = await testServer(s);
        if (result.ok) {
          console.log(`\x1b[32m✓\x1b[0m ${result.ms}ms - "${result.response}"`);
        } else {
          console.log(`\x1b[31m✗\x1b[0m ${result.error}`);
        }
      }
      console.log('');
      break;
    }

    default:
      console.log(`Unknown command: ${command}`);
      console.log('Commands: list, enable, disable, add, remove, set, test');
      process.exit(1);
  }
}

main().catch(console.error);
