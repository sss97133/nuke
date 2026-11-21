import { parseVerdict, toModelImageUrl } from './verdict.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
function throws(fn: () => unknown, re: RegExp) {
  try {
    fn();
  } catch (e) {
    assert(re.test((e as Error).message), `wrong error: ${(e as Error).message}`);
    return;
  }
  throw new Error('expected a throw');
}

Deno.test('empty reply throws', () => {
  throws(() => parseVerdict('', 'OpenAI'), /OpenAI returned no text/);
  throws(() => parseVerdict('   \n', 'OpenAI'), /no text/);
  throws(() => parseVerdict(null), /no text/);
  throws(() => parseVerdict(undefined), /no text/);
});

Deno.test('non-JSON throws', () => {
  throws(() => parseVerdict('I cannot read this image', 'OpenAI'), /not JSON/);
  throws(() => parseVerdict('{not json}', 'OpenAI'), /not JSON/);
});

Deno.test('missing or non-boolean is_sensitive throws', () => {
  throws(() => parseVerdict('{"document_type":"title"}'), /no is_sensitive/);
  throws(() => parseVerdict('{"is_sensitive":"true"}'), /no is_sensitive/);
  throws(() => parseVerdict('{"is_sensitive":null}'), /no is_sensitive/);
  throws(() => parseVerdict('{"is_sensitive":1}'), /no is_sensitive/);
});

Deno.test('fenced and wrapped JSON parses', () => {
  const fenced = '```json\n{"is_sensitive": false, "confidence": 0.9}\n```';
  assert(parseVerdict(fenced).is_sensitive === false, 'fenced');
  const wrapped = 'Here you go: {"is_sensitive": true, "document_type": "title"} done.';
  const v = parseVerdict(wrapped);
  assert(v.is_sensitive === true && v.document_type === 'title', 'wrapped');
});

Deno.test('true verdict round-trips with its fields', () => {
  const v = parseVerdict(JSON.stringify({
    is_sensitive: true, document_type: 'registration', confidence: 0.93,
    extracted_data: { state: 'NV' }, raw_text: 'REGISTRATION',
  }));
  assert(v.is_sensitive === true, 'is_sensitive');
  assert(v.document_type === 'registration', 'document_type');
  assert(v.confidence === 0.93, 'confidence');
  assert(v.extracted_data.state === 'NV', 'extracted_data');
  assert(v.raw_text === 'REGISTRATION', 'raw_text');
});

Deno.test('false verdict round-trips with defaults', () => {
  const v = parseVerdict('{"is_sensitive": false, "document_type": null, "confidence": 0.8}');
  assert(v.is_sensitive === false, 'is_sensitive');
  assert(v.document_type === null, 'document_type');
  assert(v.confidence === 0.8, 'confidence');
  assert(Object.keys(v.extracted_data).length === 0, 'extracted_data default');
  assert(v.raw_text === '', 'raw_text default');
});

Deno.test('public storage address becomes the render address', () => {
  const u = 'https://abc.supabase.co/storage/v1/object/public/vehicle-images/x/y.heic';
  assert(
    toModelImageUrl(u) ===
      'https://abc.supabase.co/storage/v1/render/image/public/vehicle-images/x/y.heic?width=1600&height=1600&resize=contain&quality=80',
    'render address',
  );
});

Deno.test('query-string and non-storage addresses are unchanged', () => {
  const q = 'https://abc.supabase.co/storage/v1/object/public/vehicle-images/x/y.jpg?token=1';
  assert(toModelImageUrl(q) === q, 'query string');
  const o = 'https://example.com/photo.jpg';
  assert(toModelImageUrl(o) === o, 'non-storage');
});
