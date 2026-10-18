import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { cellsAsOf, cellsCanAnswer, cellsClusterSql, cellsHistogramSql, readWithin } from "./cells.ts";

Deno.test("the fold answers a bbox, a zoom and a carried confidence band only", () => {
  const base = { bbox: "-113.9,31.0,-82.1,47.0", zoom: "5", limit: "5000", mode: "points" };
  assert(cellsCanAnswer(base, 0.7));
  assert(cellsCanAnswer(base, 0.5));
  assert(!cellsCanAnswer(base, 0.6), "a band the fold does not carry reads the live tables");
  for (const k of ["time_start", "time_end", "source", "event_type", "make", "year_min", "year_max", "price_min", "price_max"]) {
    assert(!cellsCanAnswer({ ...base, [k]: "x" }, 0.7), `${k} reads the live tables`);
    assert(cellsCanAnswer({ ...base, [k]: "" }, 0.7), `an empty ${k} is no filter`);
  }
});

Deno.test("cluster and histogram reads take the band and the precision's cells", () => {
  const c70 = cellsClusterSql(1, 0.7);
  assertStringIncludes(c70, "SELECT lng1 AS lng, lat1 AS lat");
  assertStringIncludes(c70, "AND conf70");
  assertStringIncludes(c70, "lat2 BETWEEN $1 AND $2 AND lng2 BETWEEN $3 AND $4");
  assertStringIncludes(c70, "LIMIT $5");
  assert(!cellsClusterSql(2, 0.5).includes("conf70"), "the 0.5 band is every row");
  assertStringIncludes(cellsClusterSql(0, 0.5), "SELECT lng0 AS lng, lat0 AS lat");
  assertStringIncludes(cellsHistogramSql(0.7), "AND conf70");
  assert(!cellsHistogramSql(0.5).includes("conf70"));
});

type Call = { sql: string };
function fakeConn(opts: { failOn?: string; asOf?: { populated: boolean; refreshed_at: string | null } } = {}) {
  const calls: Call[] = [];
  const tx = {
    begin: () => { calls.push({ sql: "BEGIN" }); return Promise.resolve(); },
    commit: () => { calls.push({ sql: "COMMIT" }); return Promise.resolve(); },
    rollback: () => { calls.push({ sql: "ROLLBACK" }); return Promise.resolve(); },
    queryObject: (q: string | { text: string }) => {
      const sql = typeof q === "string" ? q : q.text;
      calls.push({ sql });
      if (opts.failOn && sql.includes(opts.failOn)) return Promise.reject(new Error("canceling statement due to statement timeout"));
      return Promise.resolve({ rows: [{ ok: 1 }] });
    },
  };
  const conn = {
    createTransaction: (_name: string, _o: unknown) => tx,
    queryObject: (sql: string) => {
      calls.push({ sql });
      return Promise.resolve({ rows: opts.asOf ? [opts.asOf] : [] });
    },
  };
  // deno-lint-ignore no-explicit-any
  return { conn: conn as any, calls };
}

Deno.test("readWithin sets the timeout inside its own transaction and commits", async () => {
  const { conn, calls } = fakeConn();
  const r = await readWithin(conn, "SELECT 1", [], "15s");
  assertEquals(r.rows, [{ ok: 1 }]);
  assertEquals(calls.map((c) => c.sql), ["BEGIN", "SET LOCAL statement_timeout = '15s'", "SELECT 1", "COMMIT"]);
});

Deno.test("readWithin rolls back and rethrows a failed read", async () => {
  const { conn, calls } = fakeConn({ failOn: "SELECT slow" });
  await assertRejects(() => readWithin(conn, "SELECT slow", []), Error, "statement timeout");
  assertEquals(calls.map((c) => c.sql).at(-1), "ROLLBACK");
});

Deno.test("cellsAsOf: the refresh clock when filled, null before the first fill or without the fold", async () => {
  assertEquals(await cellsAsOf(fakeConn({ asOf: { populated: true, refreshed_at: "2026-10-14 12:25:00+00" } }).conn), "2026-10-14 12:25:00+00");
  assertEquals(await cellsAsOf(fakeConn({ asOf: { populated: false, refreshed_at: null } }).conn), null);
  assertEquals(await cellsAsOf(fakeConn().conn), null, "no fold yet (migration not applied): the live path answers");
});
