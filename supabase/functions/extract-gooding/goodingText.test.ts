// Run: deno test supabase/functions/extract-gooding/
import { buildFullDescription, fieldText, lotProse } from './goodingText.ts';

function equal(actual: unknown, expected: unknown, what = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what} Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const STOCK = { childMarkdownRemark: { html: '<p>Additional images and complete lot descriptions will be available closer to the Auction. Please check back for more information.</p>' } };

Deno.test('the stock line on a lot not yet written up is no description', () => {
  equal(fieldText(STOCK), null);
  equal(lotProse({ description: STOCK }).narrative, null);
  equal(buildFullDescription(lotProse({ description: STOCK }), null, []), null);
});

Deno.test('a written narrative is read from item.description and keeps its paragraphs', () => {
  const item = { description: { childMarkdownRemark: { html: '<p>Introduced in 1948, the 356 was Porsche&rsquo;s first.</p><p>Matching numbers.</p>' } } };
  equal(lotProse(item).narrative, "Introduced in 1948, the 356 was Porsche's first.\nMatching numbers.");
});

Deno.test('contentful rich text and plain strings are read too', () => {
  const raw = JSON.stringify({ nodeType: 'document', content: [{ nodeType: 'paragraph', content: [{ nodeType: 'text', value: 'Raced at Sebring in 1966.' }] }] });
  equal(fieldText({ raw }), 'Raced at Sebring in 1966.');
  equal(fieldText('<b>Factory documents</b> included'), 'Factory documents included');
  equal(fieldText(['one', 'two']), 'one\ntwo');
  equal(fieldText({ raw: 'not json' }), null);
});

Deno.test('the full description orders narrative, sections, note, then highlight bullets', () => {
  const prose = lotProse({
    description: { childMarkdownRemark: { html: '<p>The narrative.</p>' } },
    provenance: 'First owner Mr Smith.',
    raceHighlights: ['Class win 1966'],
  });
  equal(
    buildFullDescription(prose, 'From the Example Collection of fine automobiles', ['Matching-Numbers Engine per Kardex', 'abc']),
    'The narrative.\n\nProvenance\nFirst owner Mr Smith.\n\nRacing history\nClass win 1966\n\nFrom the Example Collection of fine automobiles\n\nMatching-Numbers Engine per Kardex',
  );
});
