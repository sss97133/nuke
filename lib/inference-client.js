/**
 * INFERENCE CLIENT
 *
 * Multi-server LLM inference with failover, rate limiting, and health checks.
 * Supports Ollama and OpenAI-compatible APIs.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '../config/inference-servers.json');

class InferenceClient {
  constructor(configPath = CONFIG_PATH) {
    this.config = JSON.parse(readFileSync(configPath, 'utf-8'));
    this.rateLimitState = {}; // { serverName: { tokens: [], lastReset: Date } }
    this.healthState = {}; // { serverName: { healthy: bool, lastCheck: Date, failures: int } }
    this.stats = { requests: 0, failures: 0, byServer: {} };
  }

  getEnabledServers() {
    return this.config.servers
      .filter(s => s.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  checkRateLimit(server) {
    if (!server.rateLimit) return true;

    const state = this.rateLimitState[server.name] || { tokens: [], lastReset: Date.now() };
    const now = Date.now();
    const windowMs = 60000; // 1 minute window

    // Remove old tokens outside window
    state.tokens = state.tokens.filter(t => now - t < windowMs);

    if (state.tokens.length >= server.rateLimit) {
      return false;
    }

    state.tokens.push(now);
    this.rateLimitState[server.name] = state;
    return true;
  }

  async checkHealth(server) {
    const state = this.healthState[server.name] || { healthy: true, failures: 0 };

    // Skip recently failed servers (exponential backoff)
    if (!state.healthy) {
      const backoffMs = Math.min(300000, 10000 * Math.pow(2, state.failures));
      if (Date.now() - state.lastCheck < backoffMs) {
        return false;
      }
    }

    return state.healthy;
  }

  markServerFailed(server) {
    const state = this.healthState[server.name] || { healthy: true, failures: 0 };
    state.healthy = false;
    state.failures++;
    state.lastCheck = Date.now();
    this.healthState[server.name] = state;
  }

  markServerHealthy(server) {
    this.healthState[server.name] = { healthy: true, failures: 0, lastCheck: Date.now() };
  }

  async callOllama(server, messages, options = {}) {
    const response = await fetch(`${server.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: server.model,
        messages,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.3,
          num_predict: options.maxTokens ?? 2000,
        }
      }),
      signal: AbortSignal.timeout(server.timeout || 120000),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status}`);
    }

    const data = await response.json();
    return data.message?.content || '';
  }

  async callOpenAI(server, messages, options = {}) {
    const apiKey = server.apiKeyEnv ? process.env[server.apiKeyEnv] : server.apiKey;

    if (!apiKey) {
      throw new Error(`API key not found for ${server.name}`);
    }

    const response = await fetch(server.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: server.model,
        messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 2000,
      }),
      signal: AbortSignal.timeout(server.timeout || 30000),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`API error: ${response.status} - ${error.error?.message || 'Unknown'}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async chat(messages, options = {}) {
    const servers = this.getEnabledServers();

    if (servers.length === 0) {
      throw new Error('No inference servers enabled');
    }

    const errors = [];

    for (const server of servers) {
      // Check health
      if (!await this.checkHealth(server)) {
        continue;
      }

      // Check rate limit
      if (!this.checkRateLimit(server)) {
        errors.push(`${server.name}: rate limited`);
        continue;
      }

      try {
        this.stats.requests++;
        this.stats.byServer[server.name] = (this.stats.byServer[server.name] || 0) + 1;

        let result;
        if (server.type === 'ollama') {
          result = await this.callOllama(server, messages, options);
        } else {
          result = await this.callOpenAI(server, messages, options);
        }

        this.markServerHealthy(server);
        return { content: result, server: server.name, model: server.model };

      } catch (error) {
        this.stats.failures++;
        this.markServerFailed(server);
        errors.push(`${server.name}: ${error.message}`);
        continue;
      }
    }

    throw new Error(`All servers failed: ${errors.join('; ')}`);
  }

  // Convenience method matching previous API
  async complete(systemPrompt, userPrompt, options = {}) {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];
    return this.chat(messages, options);
  }

  getStats() {
    return {
      ...this.stats,
      servers: this.getEnabledServers().map(s => ({
        name: s.name,
        healthy: this.healthState[s.name]?.healthy ?? true,
        failures: this.healthState[s.name]?.failures ?? 0,
        requests: this.stats.byServer[s.name] || 0,
      }))
    };
  }

  // Reset a server's health (e.g., after manual verification it's back)
  resetServer(serverName) {
    const server = this.config.servers.find(s => s.name === serverName);
    if (server) {
      this.markServerHealthy(server);
      return true;
    }
    return false;
  }
}

// Singleton instance
let instance = null;

export function getInferenceClient(configPath) {
  if (!instance) {
    instance = new InferenceClient(configPath);
  }
  return instance;
}

export { InferenceClient };
