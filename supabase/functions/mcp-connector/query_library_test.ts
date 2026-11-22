// Run: deno test --allow-read supabase/functions/mcp-connector/query_library_test.ts
// Loads the reference-library handler from index.ts without starting HTTP, reading credentials or reaching the
// database. The database client is a spy: a type outside the library must be refused before any table is named, and
// a library type must name exactly that table with a bounded row limit.
const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const start = source.indexOf("const LIBRARY_TYPES");
const end = source.indexOf("async function handleSearchServiceManuals");
if (start < 0 || end < start) throw new Error("index.ts no longer has the reference-library handler where this test reads it");
const moduleSource = `
interface ToolResult { content: Array<{ type: string; text: string }>; isError?: boolean }
function toolOk(data: unknown): ToolResult { return { content: [{ type: "text", text: JSON.stringify(data) }] }; }
function toolErr(msg: string): ToolResult { return { content: [{ type: "text", text: JSON.stringify({ error: msg }) }], isError: true }; }
const reads: Array<{ table: string; limit: number; filters: string[] }> = [];
const sb = () => ({
  from(table: string) {
    const read = { table, limit: -1, filters: [] as string[] };
    reads.push(read);
    // deno-lint-ignore no-explicit-any
    const query: any = {
      select: () => query,
      limit: (n: number) => { read.limit = n; return query; },
      ilike: (column: string) => { read.filters.push("ilike:" + column); return query; },
      or: (filter: string) => { read.filters.push("or:" + filter); return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return query;
  },
});
` + source.slice(start, end) + `
export { handleQueryLibrary, LIBRARY_MAX_LIMIT, LIBRARY_TYPES, reads };
`;
const connector = await import(`data:application/typescript,${encodeURIComponent(moduleSource)}`);

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("the library handler and the tool schema list the same four types", () => {
  const tool = source.slice(source.indexOf('name: "query_library"'), source.indexOf('name: "search_service_manuals"'));
  const schemaEnum = tool.match(/enum: \[([^\]]+)\]/);
  assert(!!schemaEnum, "query_library must declare an enum for type");
  const listed = [...schemaEnum[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert(JSON.stringify(listed) === JSON.stringify(connector.LIBRARY_TYPES), "schema enum and LIBRARY_TYPES must match");
  assert(connector.LIBRARY_TYPES.length === 4, "the reference library is four tables");
});

Deno.test("a type outside the library is refused before any table is read", async () => {
  for (const type of ["receipts", "vehicles", "profiles", "auth.users", "paint_codes;receipts", "PAINT_CODES", "", "undefined"]) {
    connector.reads.length = 0;
    const result = await connector.handleQueryLibrary({ type, limit: 1000 });
    assert(result.isError === true, `type ${JSON.stringify(type)} must be a tool error`);
    assert(connector.reads.length === 0, `type ${JSON.stringify(type)} must not reach the database`);
  }
  connector.reads.length = 0;
  const missing = await connector.handleQueryLibrary({});
  assert(missing.isError === true && connector.reads.length === 0, "a call with no type must be refused without a read");
});

Deno.test("a library type reads only its own table, with the limit kept between 1 and the cap", async () => {
  for (const type of connector.LIBRARY_TYPES) {
    connector.reads.length = 0;
    const result = await connector.handleQueryLibrary({ type });
    assert(!result.isError, `${type} must answer`);
    assert(connector.reads.length === 1 && connector.reads[0].table === type, `${type} must read exactly its own table`);
    assert(connector.reads[0].limit === 25, "the default limit stays 25");
  }
  const cases: Array<[unknown, number]> = [
    [1000, connector.LIBRARY_MAX_LIMIT], [1e9, connector.LIBRARY_MAX_LIMIT], [Infinity, connector.LIBRARY_MAX_LIMIT],
    [100, 100], [7, 7], [7.9, 7], ["40", 40], [0, 25], [-5, 1], ["abc", 25], [null, 25],
  ];
  for (const [given, expected] of cases) {
    connector.reads.length = 0;
    await connector.handleQueryLibrary({ type: "paint_codes", limit: given });
    assert(connector.reads[0].limit === expected, `limit ${String(given)} must become ${expected}, got ${connector.reads[0].limit}`);
  }
  assert(connector.LIBRARY_MAX_LIMIT === 100, "the cap is 100 rows");
});

Deno.test("search and make filters still apply to a library type", async () => {
  connector.reads.length = 0;
  await connector.handleQueryLibrary({ type: "paint_codes", query: "red", make: "Pontiac" });
  const filters = connector.reads[0].filters;
  assert(filters.some((f: string) => f.startsWith("or:") && f.includes("color_family.ilike.%red%")), "text search covers the paint columns");
  assert(filters.includes("ilike:make"), "make filter applies");
});
