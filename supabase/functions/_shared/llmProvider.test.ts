import { anthropicContent, callLLM, googleImagePart } from './llmProvider.ts';
const equal = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('provider payload differs'); };
const bytes = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47));
const image = (mime: string) => ({ type: 'image_url', image_url: { url: `data:${mime};base64,${bytes}` } });

Deno.test('Claude content preserves order, image bytes and actual MIME alongside text', () => {
  for (const mime of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
    equal(anthropicContent([{ type: 'text', text: 'query' }, image(mime)]), [
      { type: 'text', text: 'query' }, { type: 'image', source: { type: 'base64', media_type: mime, data: bytes } },
    ]);
  }
  equal(anthropicContent('plain text'), 'plain text');
  equal(anthropicContent([{ type: 'image', source: { type: 'url', url: 'https://example.test/photo.jpg' } }]),
    [{ type: 'image', source: { type: 'url', url: 'https://example.test/photo.jpg' } }]);
});
Deno.test('Claude URL images use a native source block, never a foreign image_url block', () => {
  equal(anthropicContent([{ type: 'image_url', image_url: { url: 'https://example.test/photo.jpg' } }]),
    [{ type: 'image', source: { type: 'url', url: 'https://example.test/photo.jpg' } }]);
});
Deno.test('Google preserves the MIME and base64 of PNG and HEIC instead of labelling every image JPEG', () => {
  for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) {
    equal(googleImagePart(`data:${mime};base64,${bytes}`), { inline_data: { mime_type: mime, data: bytes } });
  }
});
Deno.test('unsupported and malformed image payloads refuse before a provider request', async () => {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = (() => { calls++; throw new Error('unexpected provider request'); }) as typeof fetch;
  try {
    for (const url of ['data:image/heic;base64,' + bytes, 'data:text/plain;base64,' + bytes, 'data:image/png;base64,broken', 'file:///photo.jpg']) {
      let refused = false;
      try { await callLLM({ provider: 'anthropic', model: 'configured-model', apiKey: 'test-only', source: 'user' },
        [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }] }], { vision: true, maxTokens: 400 }); } catch { refused = true; }
      equal(refused, true);
    }
    equal(calls, 0);
    for (const url of ['https://example.test/photo.jpg', 'data:image/png;base64,broken']) {
      let refused = false; try { googleImagePart(url); } catch { refused = true; } equal(refused, true);
    }
  } finally { globalThis.fetch = previous; }
});
Deno.test('the actual Claude request serializer sends native image blocks and preserves the configured model/budget', async () => {
  const previous = globalThis.fetch; let body: any; let target = '';
  globalThis.fetch = (async (url, init) => {
    target = String(url); body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }], usage: {}, stop_reason: 'end_turn' }),
      { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await callLLM({ provider: 'anthropic', model: 'configured-model', apiKey: 'test-only', source: 'user' }, [
      { role: 'system', content: 'retain evidence' }, { role: 'user', content: [image('image/png'), { type: 'text', text: 'compare' }] },
    ], { vision: true, maxTokens: 400, temperature: 0.2 });
    equal(target, 'https://api.anthropic.com/v1/messages');
    equal(body.model, 'configured-model'); equal(body.max_tokens, 400); equal(body.temperature, 0.2);
    equal(body.system, 'retain evidence');
    equal(body.messages[0].content, [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: bytes } }, { type: 'text', text: 'compare' }]);
    equal(result.content, '{"ok":true}');
  } finally { globalThis.fetch = previous; }
});
Deno.test('platform Haiku uses its supported effort configuration and retains text after thinking blocks', async () => {
  const previous = globalThis.fetch; let body: any; let headers: any;
  globalThis.fetch = (async (_url, init) => {
    body = JSON.parse(String(init?.body));
    headers = init?.headers;
    return new Response(JSON.stringify({ content: [{ type: 'thinking', thinking: 'private' },
      { type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 1, output_tokens: 1 } }),
      { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await callLLM({ provider: 'anthropic', model: 'claude-haiku-5-5', apiKey: 'fixture', source: 'system', workspaceId: 'workspace-fixture' },
      [{ role: 'user', content: 'fixture' }], { maxTokens: 1600, temperature: 0.2 });
    equal(body.model, 'claude-haiku-5-5'); equal(body.max_tokens, 1600);
    equal(headers['anthropic-workspace-id'], 'workspace-fixture');
    equal('temperature' in body, false); equal(body.output_config, { effort: 'low' });
    equal(result.content, '{"ok":true}');
  } finally { globalThis.fetch = previous; }
});
