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
let responseRows: Array<Record<string, unknown>> = [];
function setResponseRows(rows: Array<Record<string, unknown>>) { responseRows = rows; }
const sb = () => ({
  from(table: string) {
    const read = { table, limit: -1, filters: [] as string[] };
    reads.push(read);
    // deno-lint-ignore no-explicit-any
    const query: any = {
      select: () => query,
      limit: (n: number) => { read.limit = n; return query; },
      ilike: (column: string, value: string) => { read.filters.push("ilike:" + column, "ilike_value:" + column + ":" + value); return query; },
      or: (filter: string) => { read.filters.push("or:" + filter); return query; },
      filter: (column: string, op: string, value: unknown) => { read.filters.push("filter:" + column + ":" + op + ":" + value); return query; },
      lte: (column: string, value: unknown) => { read.filters.push("lte:" + column + ":" + value); return query; },
      gte: (column: string, value: unknown) => { read.filters.push("gte:" + column + ":" + value); return query; },
      eq: (column: string, value: unknown) => { read.filters.push("eq:" + column + ":" + value); return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: responseRows, error: null }).then(resolve),
    };
    return query;
  },
});
` + source.slice(start, end) + `
export { handleQueryLibrary, LIBRARY_MAX_LIMIT, LIBRARY_TYPES, reads, setResponseRows };
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

Deno.test("year, make and model filter the corresponding recorded fields", async () => {
  connector.reads.length = 0;
  await connector.handleQueryLibrary({ type: "condition_knowledge", year: 1987, make: "GMC", model: "Blazer" });
  const condition = connector.reads[0].filters;
  assert(condition.includes('filter:applicable_makes:cs:{"GMC"}'), "make uses the recorded makes array");
  assert(condition.includes('filter:applicable_models:cs:{"Blazer"}'), "model uses the recorded models array");
  assert(condition.includes("filter:applicable_years:ov:[1987,1988)"), "year overlaps exactly the requested integer year");

  connector.reads.length = 0;
  await connector.handleQueryLibrary({ type: "condition_knowledge", year: 1900 });
  assert(connector.reads[0].filters.includes("filter:applicable_years:ov:[1900,1901)"), "a different year gets a different range");

  connector.reads.length = 0;
  await connector.handleQueryLibrary({ type: "paint_codes", year: 1987 });
  assert(connector.reads[0].filters.includes("lte:year_start:1987"), "paint begins on or before year");
  assert(connector.reads[0].filters.includes("gte:year_end:1987"), "paint ends on or after year");

  connector.reads.length = 0;
  await connector.handleQueryLibrary({ type: "vehicle_nomenclature", year: 1987, model: "V10" });
  assert(connector.reads[0].filters.includes("eq:year:1987"), "nomenclature year is exact");
  assert(connector.reads[0].filters.includes("ilike:model"), "nomenclature model is filtered");
});

Deno.test("invalid or unsupported filters fail before a table is read", async () => {
  for (const args of [
    { type: "condition_knowledge", year: 1987.5 },
    { type: "condition_knowledge", year: "1987" },
    { type: "condition_knowledge", year: 2147483647 },
    { type: "condition_knowledge", model: "  " },
    { type: "condition_taxonomy", year: 1987 },
    { type: "condition_taxonomy", make: "GMC" },
    { type: "paint_codes", model: "K10" },
  ]) {
    connector.reads.length = 0;
    const result = await connector.handleQueryLibrary(args);
    assert(result.isError === true, `${JSON.stringify(args)} must fail`);
    assert(connector.reads.length === 0, "unsupported filters must not silently return unfiltered rows");
  }
});

Deno.test("condition records identify unassessed evidence and preserve missing chunk links", async () => {
  connector.setResponseRows([{ id: "a", chunk_id: null }, { id: "b", chunk_id: "chunk" }]);
  try {
    const result = await connector.handleQueryLibrary({ type: "condition_knowledge", year: 1987 });
    const body = JSON.parse(result.content[0].text);
    assert(body.filter_basis.includes("recorded_metadata_only"), "filter is not presented as verified applicability");
    assert(body.results[0].reader_qualification.recorded_chunk_link === "missing", "missing source link remains explicit");
    assert(body.results[1].reader_qualification.recorded_chunk_link === "present", "existing source link is not lost");
    assert(body.results.every((r: { reader_qualification: { source_page: string; vehicle_application: string } }) =>
      r.reader_qualification.source_page === "not_assessed" && r.reader_qualification.vehicle_application === "not_assessed"),
      "this reader must not claim the source or application was verified");
  } finally {
    connector.setResponseRows([]);
  }
});

Deno.test("array literals preserve a single make/model when input contains quotes or commas", async () => {
  connector.reads.length = 0;
  await connector.handleQueryLibrary({ type: "condition_knowledge", model: 'A, "B"' });
  assert(connector.reads[0].filters.includes('filter:applicable_models:cs:{"A, \\"B\\""}'),
    "the filter must escape one array element instead of creating multiple values");
});

Deno.test("make and model names do not introduce wildcard matching", async () => {
  connector.reads.length = 0;
  await connector.handleQueryLibrary({ type: "vehicle_nomenclature", make: "G_M%C", model: "V_10" });
  const filters = connector.reads[0].filters;
  assert(filters.includes('ilike_value:make:G\\_M\\%C'), "make wildcard characters are literal");
  assert(filters.includes('ilike_value:model:V\\_10'), "model wildcard characters are literal");
});
