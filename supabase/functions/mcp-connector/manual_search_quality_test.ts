// Run: deno test --allow-read supabase/functions/mcp-connector/manual_search_quality_test.ts
// Exercise both the full-text and fallback paths without a network or database.
const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
const start = source.indexOf('async function handleSearchServiceManuals');
const end = source.indexOf('// ── Vision', start);
if (start < 0 || end < start) throw new Error('Manual search handler moved');
const moduleSource = `
interface ToolResult { content: Array<{ type: string; text: string }>; isError?: boolean }
function toolOk(data: unknown): ToolResult { return { content: [{ type: "text", text: JSON.stringify(data) }] }; }
function toolErr(message: string): ToolResult { return { content: [{ type: "text", text: message }], isError: true }; }
let failText = false;
const methods: string[] = [];
function setFailText(value: boolean) { failText = value; methods.length = 0; }
const sb = () => ({
  from(table: string) {
    methods.push(table);
    let fullText = false;
    const query = {
      select() { return query; },
      textSearch() { fullText = true; methods.push("textSearch"); return query; },
      ilike() { methods.push("ilike"); return query; },
      limit() { return Promise.resolve(fullText && failText
        ? { data: null, error: { message: "text search unavailable" } }
        : { data: [{ id: "chunk", content: "A recorded summary", page_number: 300 }], error: null }); },
    };
    return query;
  },
});
` + source.slice(start, end) + `
export { handleSearchServiceManuals, setFailText, methods };
`;
const connector = await import(`data:application/typescript,${encodeURIComponent(moduleSource)}`);

Deno.test('manual search preserves raw content and labels source quality as unassessed in both paths', async () => {
  for (const failText of [false, true]) {
    connector.setFailText(failText);
    const result = await connector.handleSearchServiceManuals({ query: 'body mount' });
    if (result.isError) throw new Error('Manual search unexpectedly failed');
    const body = JSON.parse(result.content[0].text);
    if (body.count !== 1 || body.chunks[0].content !== 'A recorded summary') throw new Error('Raw chunk changed');
    if (body.reader_qualification.verbatim_text !== 'not_assessed' ||
        body.reader_qualification.source_page !== 'not_assessed' ||
        body.reader_qualification.vehicle_application !== 'not_assessed') {
      throw new Error('Reader must not assert that text, page or application were verified');
    }
    if (failText !== connector.methods.includes('ilike')) throw new Error('Unexpected fallback behavior');
  }
});
