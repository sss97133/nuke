import test from "node:test";
import assert from "node:assert/strict";
import { scan } from "./no-swallowed-write-errors.mjs";

const kinds = (src) => scan(src).map((h) => h.kind);

test("a bare awaited write is dropped", () => {
  assert.deepEqual(kinds(`await supabase.from('t').upsert({ a: 1 }, { onConflict: 'a' });`), ["dropped"]);
});

test("a multi-line chain with only data read is dropped", () => {
  assert.deepEqual(kinds(`const { data } = await supabase
  .from('t')
  .insert({ a: 1 })
  .select('id');
use(data);`), ["dropped"]);
});

test("error destructured and thrown is clean", () => {
  assert.deepEqual(kinds(`const { error } = await supabase.from('t').insert({ a: 1 });
if (error) throw new Error(error.message);`), []);
});

test("error only console-logged is log-only", () => {
  assert.deepEqual(kinds(`const { error } = await supabase.from('t').insert({ a: 1 });
if (error) {
  console.error('insert failed', error.message);
}
next();`), ["log-only"]);
});

test("error pushed into the run's errors is clean", () => {
  assert.deepEqual(kinds(`const { error: e1 } = await supabase.from('t').insert({ a: 1 });
if (e1) {
  console.error(e1);
  dbErrors.push(e1.message);
}`), []);
});

test("mustWrite and softWrite wrappers are clean", () => {
  assert.deepEqual(kinds(`mustWrite('t insert', await supabase.from('t').insert({ a: 1 }));`), []);
  assert.deepEqual(kinds(`softWrite('t update', await supabase.from('t').update({ a: 1 }).eq('id', 1), errs);`), []);
});

test("a write-error-ok marker argues an exception", () => {
  assert.deepEqual(kinds(`// write-error-ok: best-effort cache
await supabase.from('t').update({ a: 1 }).eq('id', 1);`), []);
});

test("a returned write hands the result to the caller", () => {
  assert.deepEqual(kinds(`return await supabase.from('t').insert({ a: 1 });`), []);
});

test("non-supabase .update( calls are ignored", () => {
  assert.deepEqual(kinds(`cache.update({ a: 1 });\nconst m = new Map(); m.delete(1);`), []);
});
