// Acceptance cases A/B/C (nuke-strategy/image-context-review.md) for the cloud classifier path.
import { __setGuardDb, allowAllGuardDb } from '../_shared/geminiGuard.ts';
__setGuardDb(allowAllGuardDb());
import { classifyImage, isDocumentFrame, ledgerPromptText, promptWithContext, CLASSIFIER_CONTEXT_MAX_CHARS } from './classifier.ts';
function assert(value: unknown, message = 'assertion failed'): asserts value { if (!value) throw new Error(message); }

const BMW_URL = 'https://bringatrailer.com/wp-content/uploads/2023/10/1973_bmw_m90-powered-3.0-cs_1973_bmw_m90-powered-3.0-cs_doc01716220231108142612_111-94449-1-64769.jpg';
const OLDS_URL = 'https://bringatrailer.com/wp-content/uploads/2021/05/1970_oldsmobile_442_16262892017ba846e20210714_102218_HDR.jpg';
const VETTE_URL = 'https://bringatrailer.com/wp-content/uploads/2025/03/Photo-Mar-19-2025-12-25-18-PM-99699.jpg';

Deno.test('A: the BMW repair-order scan is gated as a document before any condition route', () => {
  assert(isDocumentFrame(null, BMW_URL));
  assert(!isDocumentFrame(null, OLDS_URL) && !isDocumentFrame(null, VETTE_URL));
  assert(isDocumentFrame(null, 'https://x/1973_bmw_Log-for-72-BMW-3.0-CS_Page_5-93957.jpg'));
  assert(isDocumentFrame(null, 'https://x/a.jpg', ['Document']));
});

Deno.test('B: the 442 description claim reaches the classifier prompt, fenced as a claim', async () => {
  const packet = { identity: { year: 1970, make: 'Oldsmobile', model: '442 5-Speed' },
    description: 'Features include a W-30-style fiberglass hood with dual scoops', receipt_items: [], timeline: [] };
  const text = ledgerPromptText(packet);
  assert(text.includes('W-30-style fiberglass hood') && text.includes('seller claims, not truth'));
  const bodies: string[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    if (bodies.length === 0 && !init?.body) { bodies.push(''); return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }); }
    bodies.push(String(init?.body ?? ''));
    if (String(url).endsWith(':countTokens')) return Response.json({ totalTokens: 900 });
    return Response.json({ usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 50, totalTokenCount: 950 },
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ image_type: 'engine_bay', image_medium: 'photograph', confidence: 0.8, is_automotive: true, description: 'underside of a ram-air hood' }) }] } }] });
  }) as typeof fetch;
  await classifyImage(OLDS_URL, 'k', fetcher, { context: text });
  assert(bodies.some((b) => b.includes('W-30-style fiberglass hood')), 'context not sent to the model');
  assert(promptWithContext(undefined) === promptWithContext(''));
  assert(promptWithContext('x'.repeat(10_000)).length < promptWithContext('') .length + CLASSIFIER_CONTEXT_MAX_CHARS + 600);
});

Deno.test('C: without a Y/M/M baseline the prompt states condition is absolute', () => {
  const text = ledgerPromptText({ identity: { year: 2003, make: 'Chevrolet', model: 'Corvette' }, receipt_items: [], timeline: [], condition_baseline: null });
  assert(text.includes('none (condition is absolute, not relative)'));
});
